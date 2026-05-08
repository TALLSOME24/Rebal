// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PortfolioAgent — on-chain audited rebalance reasoning loop
/// @notice Uses HTTP 0x0801 for live quotes, LLM 0x0802 for reasoning. One async precompile
///         per scheduled tick; alternating tick indices fetch then reason (projection SPC constraint).
interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function depositFor(address user, uint256 lockDuration) external payable;
    function balanceOf(address account) external view returns (uint256);
}

interface IScheduler {
    function schedule(
        bytes calldata data,
        uint32 gasLimit,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 value,
        address payer
    ) external returns (uint256 callId);

    function cancel(uint256 callId) external;
}

/// @dev ABI decode helper for LLM response `updated_convo_history` tuple
struct ConvoStorageRef {
    string platform;
    string path;
    string creds;
}

/// @author Ritual Chain dApp (HTTP + LLM + Scheduler composition)
contract PortfolioAgent {
    address public constant HTTP_PRECOMPILE = 0x0000000000000000000000000000000000000801;
    address public constant LLM_PRECOMPILE = 0x0000000000000000000000000000000000000802;

    address public constant RITUAL_WALLET = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;
    address public constant SCHEDULER_CONST = 0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B;

    IScheduler public immutable scheduler;

    enum RiskMode {
        Conservative,
        Balanced,
        Aggressive
    }

    struct Portfolio {
        bool registered;
        RiskMode riskMode;
        /// @dev Basis points for ETH / WBTC / USDC (canonical CoinGecko batch); must sum to 10_000
        uint16 ethBps;
        uint16 wbtcBps;
        uint16 usdcBps;
        address executor;
        uint256 scheduleId;
    }

    mapping(address => Portfolio) public portfolios;

    mapping(address => bytes) internal _lastPricesBody;
    mapping(address => uint256) public lastCycleId;

    string public constant COINGECKO_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,usd-coin&vs_currencies=usd";

    string public constant MODEL = "zai-org/GLM-4.7-FP8";

    event PortfolioRegistered(address indexed owner, RiskMode risk, uint16 ethBps, uint16 wbtcBps, uint16 usdcBps);
    event FeesDepositFor(address indexed user, uint256 amountWei);
    event AutomationScheduled(address indexed owner, uint256 indexed callId, uint32 frequency, uint32 numCalls);
    event AutomationCancelled(address indexed owner, uint256 indexed callId);
    event PricesSnapshot(
        address indexed owner,
        uint256 indexed executionIndex,
        uint256 indexed cycleId,
        uint16 statusCode,
        bytes body
    );
    event RebalanceDecision(
        address indexed owner,
        uint256 indexed cycleId,
        uint256 indexed executionIndex,
        bool llmHasError,
        bytes completionPayload,
        string errorMessage,
        bytes32 pricesHash,
        RiskMode riskMode
    );

    /// @notice Read a user balance on RitualWallet (for UX).
    function ritualBalance(address user) external view returns (uint256) {
        return IRitualWallet(RITUAL_WALLET).balanceOf(user);
    }

    modifier onlyScheduler() {
        require(msg.sender == address(scheduler), "not scheduler");
        _;
    }

    constructor(address _scheduler) {
        require(_scheduler == SCHEDULER_CONST, "scheduler addr");
        scheduler = IScheduler(_scheduler);
    }

    receive() external payable {}

    /// @notice Credits msg.sender RitualWallet (not this contract pool) via native transfer.
    function depositFeesForCaller(uint256 lockDurationBlocks) external payable {
        require(msg.value > 0, "value");
        (bool ok,) = RITUAL_WALLET.call{value: msg.value}(
            abi.encodeWithSignature("depositFor(address,uint256)", msg.sender, lockDurationBlocks)
        );
        require(ok, "depositFor failed");
        emit FeesDepositFor(msg.sender, msg.value);
    }

    /// @notice Register or update YOUR portfolio weights (basis points sum to 10_000)
    function registerPortfolio(RiskMode risk, uint16 ethBps_, uint16 wbtcBps_, uint16 usdcBps_, address executor)
        external
    {
        require(ethBps_ + wbtcBps_ + usdcBps_ == 10_000, "bps sum");
        require(executor != address(0), "executor");

        portfolios[msg.sender].registered = true;
        portfolios[msg.sender].riskMode = risk;
        portfolios[msg.sender].ethBps = ethBps_;
        portfolios[msg.sender].wbtcBps = wbtcBps_;
        portfolios[msg.sender].usdcBps = usdcBps_;
        portfolios[msg.sender].executor = executor;

        emit PortfolioRegistered(msg.sender, risk, ethBps_, wbtcBps_, usdcBps_);
    }

    /// @notice Start alternating HTTP → LLM automation for msg.sender's portfolio.
    /// @param frequencyBlocks scheduler cadence (~50 blocks ~= ~17.5s baseline)
    /// @param schedulerTtl MUST cover HTTP/LLM async settlement + replay (see ritual-dapp-scheduler TTL guide)
    function startAutomation(uint32 frequencyBlocks, uint32 numCycles, uint32 gasLimit, uint256 maxFeePerGas, uint32 schedulerTtl)
        external
    {
        Portfolio storage p = portfolios[msg.sender];
        require(p.registered, "!registered");
        require(p.executor != address(0), "!executor");

        uint32 totalRuns = uint32(numCycles) * 2;
        require(totalRuns >= 2, "runs");

        if (p.scheduleId != 0) {
            scheduler.cancel(p.scheduleId);
            emit AutomationCancelled(msg.sender, p.scheduleId);
        }

        bytes memory data = abi.encodeCall(this.onScheduledTick, (uint256(0), msg.sender));

        uint256 callId = scheduler.schedule(
            data,
            gasLimit,
            uint32(block.number + frequencyBlocks),
            totalRuns,
            frequencyBlocks,
            schedulerTtl,
            maxFeePerGas,
            0,
            0,
            msg.sender
        );

        p.scheduleId = callId;
        emit AutomationScheduled(msg.sender, callId, frequencyBlocks, totalRuns);
    }

    function cancelAutomation() external {
        Portfolio storage p = portfolios[msg.sender];
        require(p.scheduleId != 0, "no sch");
        scheduler.cancel(p.scheduleId);
        emit AutomationCancelled(msg.sender, p.scheduleId);
        p.scheduleId = 0;
    }

    /// @notice Read last stored CoinGecko response body bytes (UTF8 JSON).
    function lastPricesBody(address owner) external view returns (bytes memory) {
        return _lastPricesBody[owner];
    }

    /// @dev Scheduler entry: even index = HTTP prices, odd = LLM reasoning
    function onScheduledTick(uint256 executionIndex, address portfolioOwner) external onlyScheduler {
        Portfolio storage p = portfolios[portfolioOwner];
        require(p.registered && p.executor != address(0), "bad pf");

        if (executionIndex % 2 == 0) {
            _runHttpPrices(executionIndex, portfolioOwner);
        } else {
            _runLLM(executionIndex, portfolioOwner);
        }
    }

    function _runHttpPrices(uint256 executionIndex, address portfolioOwner) internal {
        bytes memory encoded = abi.encode(
            portfolios[portfolioOwner].executor,
            new bytes[](0),
            uint256(120),
            new bytes[](0),
            bytes(""),
            COINGECKO_URL,
            uint8(1),
            new string[](0),
            new string[](0),
            bytes(""),
            uint256(0),
            uint8(0),
            false
        );

        (bool success, bytes memory result) = HTTP_PRECOMPILE.call(encoded);
        require(success, "http call failed");

        (, bytes memory actualOutput) = abi.decode(result, (bytes, bytes));
        uint16 status = 0;
        bytes memory body = bytes("");
        string memory transportErr = "";
        if (actualOutput.length > 0) {
            string[] memory emptK;
            string[] memory emptV;
            (status, emptK, emptV, body, transportErr) =
                abi.decode(actualOutput, (uint16, string[], string[], bytes, string));
        }
        if (bytes(transportErr).length > 0) {
            _lastPricesBody[portfolioOwner] = bytes("");
            emit PricesSnapshot(portfolioOwner, executionIndex, executionIndex / 2, 0, abi.encodePacked(transportErr));
            return;
        }

        _lastPricesBody[portfolioOwner] = body;
        uint256 cyc = executionIndex / 2;
        emit PricesSnapshot(portfolioOwner, executionIndex, cyc, status, body);
    }

    function _runLLM(uint256 executionIndex, address portfolioOwner) internal {
        Portfolio storage p = portfolios[portfolioOwner];
        bytes memory pj = _lastPricesBody[portfolioOwner];
        bytes32 phash = keccak256(pj);
        bytes memory msgs = _encodeMessages(portfolioOwner, p, pj);

        bytes memory input = abi.encode(
            p.executor,
            new bytes[](0),
            uint256(300),
            new bytes[](0),
            bytes(""),
            string(msgs),
            MODEL,
            int256(0),
            "",
            false,
            int256(4096),
            "",
            "",
            uint256(1),
            true,
            int256(0),
            string("medium"),
            bytes(""),
            int256(-1),
            "auto",
            "",
            false,
            int256(_temperatureForRisk(p.riskMode)),
            bytes(""),
            bytes(""),
            int256(-1),
            int256(1000),
            "",
            false,
            abi.encode(string(""), string(""), string(""))
        );

        (bool success, bytes memory result) = LLM_PRECOMPILE.call(input);
        require(success, "llm call failed");

        (, bytes memory actualOutput) = abi.decode(result, (bytes, bytes));
        bool hasErr = true;
        bytes memory completion = bytes("");
        string memory errorMsg = "";
        if (actualOutput.length > 0) {
            ConvoStorageRef memory _convo;
            (hasErr, completion, , errorMsg, _convo) =
                abi.decode(actualOutput, (bool, bytes, bytes, string, ConvoStorageRef));
        }

        uint256 cyc = executionIndex / 2;
        lastCycleId[portfolioOwner] = cyc;

        emit RebalanceDecision(portfolioOwner, cyc, executionIndex, hasErr, completion, errorMsg, phash, p.riskMode);
    }

    function _temperatureForRisk(RiskMode r) internal pure returns (uint256 scaled) {
        if (r == RiskMode.Conservative) return 200;
        if (r == RiskMode.Balanced) return 600;
        return 950;
    }

    /// @notice Pack OpenAI-compatible messages JSON with hex-coded price blob to avoid escaping raw JSON quotes in Solidity.
    function _encodeMessages(address owner_, Portfolio storage p, bytes memory pj) internal view returns (bytes memory) {
        bytes memory hexBody = _toHex(pj);
        bytes memory riskLine = bytes(_riskInstructions(p.riskMode));

        bytes memory userChunk = abi.encodePacked(
            'OWNER=', _addrToAscii(owner_),
            ';TARGET_ETH_BPS=', uint2dec(p.ethBps),
            ';TARGET_WBTC_BPS=', uint2dec(p.wbtcBps),
            ';TARGET_USDC_BPS=', uint2dec(p.usdcBps),
            ';PRICES_JSON_HEX=', hexBody
        );

        return abi.encodePacked(
            '[{"role":"system","content":"',
            riskLine,
            ' You MUST answer with concise JSON-only object keys: rationale (string<=800 chars); suggested_moves (array of objects {asset: eth|btc|usdc|ritual_eth, drift_bps: int, note: string}). Drift compares implied USD weights from decoding PRICES_JSON_HEX (utf8 json) versus targets given in this user message as bps. No markdown."},',
            '{"role":"user","content":"',
            userChunk,
            '"}]'
        );
    }

    function _riskInstructions(RiskMode r) internal pure returns (string memory) {
        if (r == RiskMode.Conservative) {
            return "Risk=CONSERVATIVE. Prefer smaller adjustments; emphasize capital preservation.";
        }
        if (r == RiskMode.Balanced) {
            return "Risk=BALANCED. Balance drawdown sensitivity with drift correction.";
        }
        return "Risk=AGGRESSIVE. Allow larger suggested correction steps when drift is material.";
    }

    function _addrToAscii(address a) internal pure returns (bytes memory out) {
        bytes memory alphabet = "0123456789abcdef";
        out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(uint160(a) >> (8 * (19 - i)));
            out[2 + i * 2] = alphabet[b >> 4];
            out[3 + i * 2] = alphabet[b & 0x0f];
        }
    }

    function uint2dec(uint256 v) internal pure returns (bytes memory) {
        if (v == 0) return "0";
        uint256 temp = v;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buf = new bytes(digits);
        while (v != 0) {
            digits--;
            buf[digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return buf;
    }

    function _toHex(bytes memory data) internal pure returns (bytes memory) {
        if (data.length == 0) return "0x";
        bytes16 alphabet = "0123456789abcdef";
        bytes memory str = new bytes(2 + data.length * 2);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < data.length; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return str;
    }
}
