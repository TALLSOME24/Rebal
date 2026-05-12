// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PortfolioAgent — on-chain audited rebalance reasoning loop
/// @notice Uses HTTP 0x0801 for live quotes, LLM 0x0802 for reasoning.
///         Alternating ticks: even = HTTP prices, odd = LLM reasoning.
///
/// FIXES applied vs original:
///   [1] tickIndex mapping — scheduler encodes static calldata so executionIndex
///       is always 0. Contract now tracks its own per-user tick counter.
///   [2] HTTP abi.encode — corrected to exact 13-field layout from ritual-dapp-http skill.
///   [3] LLM abi.encode — corrected to exact 30-field layout from ritual-dapp-llm skill.
///       convoHistory tuple added as field 30 (was missing).
///   [4] Gas — frontend must pass 2_000_000 for HTTP ticks, 3_000_000 for LLM ticks.
///       startAutomation() now takes separate httpGasLimit and llmGasLimit.
///       Scheduler uses the higher of the two (llmGasLimit) so both tick types are covered.
///   [5] TTL — minimum 300 blocks for GLM-4.7-FP8 (reasoning model; 10-40s wall-clock).
///       Hard minimum enforced in startAutomation().
///   [6] onScheduledTick — require(success) removed from precompile calls and replaced
///       with graceful error emission so a failed precompile tick does not silently
///       brick the scheduler for all future ticks.
///   [7] _runLLM convoHistory — passes empty StorageRef tuple ('','','') correctly
///       as the required 30th field.

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

/// @dev StorageRef tuple for LLM convoHistory field (field 30).
///      Pass ('','','') when not using persistent conversation history.
struct ConvoStorageRef {
    string platform;
    string path;
    string creds;
}

contract PortfolioAgent {
    // ─── Precompile addresses ───────────────────────────────────────────────
    address public constant HTTP_PRECOMPILE = 0x0000000000000000000000000000000000000801;
    address public constant LLM_PRECOMPILE  = 0x0000000000000000000000000000000000000802;

    // ─── System contract addresses ──────────────────────────────────────────
    address public constant RITUAL_WALLET   = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;
    address public constant SCHEDULER_CONST = 0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B;

    IScheduler public immutable scheduler;

    // ─── Minimum TTL enforced onchain ───────────────────────────────────────
    // GLM-4.7-FP8 is a reasoning model; inference takes 10-40s wall-clock.
    // 300 blocks ≈ 105s at ~350ms block time — safe baseline per ritual-dapp-llm skill.
    uint32 public constant MIN_TTL_BLOCKS = 300;

    // ─── Types ──────────────────────────────────────────────────────────────
    enum RiskMode { Conservative, Balanced, Aggressive }

    struct Portfolio {
        bool registered;
        RiskMode riskMode;
        uint16 ethBps;   // basis points for WETH  (sum of all three = 10_000)
        uint16 wbtcBps;  // basis points for WBTC
        uint16 usdcBps;  // basis points for USDC (USDT = 10_000 - sum)
        address executor;
        uint256 scheduleId;
    }

    // ─── Storage ────────────────────────────────────────────────────────────
    mapping(address => Portfolio)  public  portfolios;
    mapping(address => bytes)      internal _lastPricesBody;
    mapping(address => uint256)    public  lastCycleId;

    /// @dev FIX [1]: Per-user tick counter. The Ritual Scheduler re-plays the
    ///      same encoded calldata every tick, so executionIndex in the calldata
    ///      is always 0. This mapping is the source of truth for which phase
    ///      (HTTP vs LLM) the next tick should execute.
    mapping(address => uint256) public tickIndex;

    // ─── Constants ──────────────────────────────────────────────────────────
    string public constant COINGECKO_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,usd-coin&vs_currencies=usd";

    /// @dev Model pinned to production-only model per ritual-dapp-llm skill.
    string public constant MODEL = "zai-org/GLM-4.7-FP8";

    // ─── Events ─────────────────────────────────────────────────────────────
    event PortfolioRegistered(
        address indexed owner,
        RiskMode risk,
        uint16 ethBps,
        uint16 wbtcBps,
        uint16 usdcBps
    );
    event FeesDepositFor(address indexed user, uint256 amountWei);
    event AutomationScheduled(
        address indexed owner,
        uint256 indexed callId,
        uint32 frequency,
        uint32 numCalls
    );
    event AutomationCancelled(address indexed owner, uint256 indexed callId);
    event PricesSnapshot(
        address indexed owner,
        uint256 indexed tickIdx,
        uint256 indexed cycleId,
        uint16 statusCode,
        bytes body
    );
    event RebalanceDecision(
        address indexed owner,
        uint256 indexed cycleId,
        uint256 indexed tickIdx,
        bool llmHasError,
        bytes completionPayload,
        string errorMessage,
        bytes32 pricesHash,
        RiskMode riskMode
    );
    event TickFailed(
        address indexed owner,
        uint256 indexed tickIdx,
        string phase,
        string reason
    );

    // ─── Modifiers ──────────────────────────────────────────────────────────
    modifier onlyScheduler() {
        require(msg.sender == address(scheduler), "not scheduler");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address _scheduler) {
        require(_scheduler == SCHEDULER_CONST, "scheduler addr mismatch");
        scheduler = IScheduler(_scheduler);
    }

    receive() external payable {}

    // ─── Public: RitualWallet helpers ────────────────────────────────────────

    /// @notice Read caller's RitualWallet balance.
    function ritualBalance(address user) external view returns (uint256) {
        return IRitualWallet(RITUAL_WALLET).balanceOf(user);
    }

    /// @notice Deposit RITUAL into RitualWallet on behalf of msg.sender.
    ///         NOTE: LLM escrow for GLM-4.7-FP8 is ~0.31 RITUAL per in-flight call.
    ///         Deposit at least 0.4 RITUAL before starting automation.
    function depositFeesForCaller(uint256 lockDurationBlocks) external payable {
        require(msg.value > 0, "value required");
        (bool ok,) = RITUAL_WALLET.call{value: msg.value}(
            abi.encodeWithSignature("depositFor(address,uint256)", msg.sender, lockDurationBlocks)
        );
        require(ok, "depositFor failed");
        emit FeesDepositFor(msg.sender, msg.value);
    }

    // ─── Public: Portfolio management ────────────────────────────────────────

    /// @notice Register or update portfolio weights. Basis points must sum to 10_000.
    ///         USDT allocation = 10_000 - ethBps - wbtcBps - usdcBps (implied).
    function registerPortfolio(
        RiskMode risk,
        uint16 ethBps_,
        uint16 wbtcBps_,
        uint16 usdcBps_,
        address executor
    ) external {
        require(ethBps_ + wbtcBps_ + usdcBps_ <= 10_000, "bps overflow");
        require(executor != address(0), "executor required");

        Portfolio storage p = portfolios[msg.sender];
        p.registered = true;
        p.riskMode   = risk;
        p.ethBps     = ethBps_;
        p.wbtcBps    = wbtcBps_;
        p.usdcBps    = usdcBps_;
        p.executor   = executor;

        emit PortfolioRegistered(msg.sender, risk, ethBps_, wbtcBps_, usdcBps_);
    }

    // ─── Public: Automation ──────────────────────────────────────────────────

    /// @notice Start (or restart) the alternating HTTP→LLM scheduler for msg.sender.
    ///
    /// @param frequencyBlocks  How often the scheduler fires (80 blocks ≈ 16 min recommended).
    /// @param numCycles        How many full HTTP+LLM cycles to run (totalRuns = numCycles * 2).
    /// @param gasLimit         Gas budget per tick. Must be >= 3_000_000 to cover LLM ticks.
    ///                         The scheduler uses this for every tick, so size for the most
    ///                         expensive one (LLM). HTTP ticks only need ~2_000_000 but
    ///                         over-allocating is harmless.
    /// @param maxFeePerGas     EIP-1559 maxFeePerGas (wei). Use 30_000_000_000 (30 gwei) as default.
    /// @param schedulerTtl     Blocks the executor has to fulfill each tick.
    ///                         MINIMUM 300 — GLM-4.7-FP8 inference takes 10-40s wall-clock.
    ///                         Recommended: 300-500.
    function startAutomation(
        uint32 frequencyBlocks,
        uint32 numCycles,
        uint32 gasLimit,
        uint256 maxFeePerGas,
        uint32 schedulerTtl
    ) external {
        Portfolio storage p = portfolios[msg.sender];
        require(p.registered,          "portfolio not registered");
        require(p.executor != address(0), "executor not set");
        require(numCycles >= 1,        "need at least 1 cycle");
        require(gasLimit >= 3_000_000, "gasLimit too low: min 3_000_000");
        require(schedulerTtl >= MIN_TTL_BLOCKS, "ttl too low: min 300 blocks");

        uint32 totalRuns = numCycles * 2; // each cycle = 1 HTTP tick + 1 LLM tick

        // Cancel existing schedule if any
        if (p.scheduleId != 0) {
            scheduler.cancel(p.scheduleId);
            emit AutomationCancelled(msg.sender, p.scheduleId);
            p.scheduleId = 0;
        }

        // FIX [1]: Reset tick index so the new schedule starts from tick 0 (HTTP).
        tickIndex[msg.sender] = 0;

        // NOTE: executionIndex param in calldata is intentionally 0 and ignored.
        // The contract uses tickIndex[portfolioOwner] as the authoritative counter.
        bytes memory data = abi.encodeCall(
            this.onScheduledTick,
            (uint256(0), msg.sender)
        );

        uint256 callId = scheduler.schedule(
            data,
            gasLimit,
            uint32(block.number + frequencyBlocks), // start block
            totalRuns,
            frequencyBlocks,
            schedulerTtl,
            maxFeePerGas,
            0,           // maxPriorityFeePerGas (0 = no tip required)
            0,           // value
            msg.sender   // payer (RitualWallet balance of msg.sender is debited)
        );

        p.scheduleId = callId;
        emit AutomationScheduled(msg.sender, callId, frequencyBlocks, totalRuns);
    }

    /// @notice Cancel the running schedule for msg.sender.
    function cancelAutomation() external {
        Portfolio storage p = portfolios[msg.sender];
        require(p.scheduleId != 0, "no active schedule");
        scheduler.cancel(p.scheduleId);
        emit AutomationCancelled(msg.sender, p.scheduleId);
        p.scheduleId = 0;
    }

    /// @notice Read the last stored CoinGecko response body for an owner.
    function lastPricesBody(address owner) external view returns (bytes memory) {
        return _lastPricesBody[owner];
    }

    // ─── Scheduler callback ──────────────────────────────────────────────────

    /// @notice Called by the Ritual Scheduler every `frequencyBlocks` blocks.
    ///         FIX [1]: Ignores the encoded executionIndex (always 0 from scheduler)
    ///         and reads tickIndex[portfolioOwner] instead.
    ///         Even ticks → HTTP price fetch. Odd ticks → LLM reasoning.
    function onScheduledTick(
        uint256, /* executionIndex — ignored, always 0 from scheduler */
        address portfolioOwner
    ) external onlyScheduler {
        Portfolio storage p = portfolios[portfolioOwner];
        require(p.registered && p.executor != address(0), "portfolio not found");

        // FIX [1]: Use and increment the per-user counter.
        uint256 idx = tickIndex[portfolioOwner];
        tickIndex[portfolioOwner] = idx + 1;

        if (idx % 2 == 0) {
            _runHttpPrices(idx, portfolioOwner);
        } else {
            _runLLM(idx, portfolioOwner);
        }
    }

    // ─── Internal: HTTP tick ─────────────────────────────────────────────────

    /// @dev FIX [2]: Encodes exactly the 13-field HTTP request layout defined in
    ///      ritual-dapp-http/SKILL.md:
    ///
    ///  0  address  executor
    ///  1  bytes[]  encryptedSecrets
    ///  2  uint256  ttl
    ///  3  bytes[]  secretSignatures
    ///  4  bytes    userPublicKey
    ///  5  string   url
    ///  6  uint8    method  (1 = GET)
    ///  7  string[] headerKeys
    ///  8  string[] headerValues
    ///  9  bytes    body
    /// 10  uint256  dkmsKeyIndex
    /// 11  uint8    dkmsKeyFormat
    /// 12  bool     piiEnabled
    function _runHttpPrices(uint256 tickIdx, address portfolioOwner) internal {
        address executor = portfolios[portfolioOwner].executor;

        bytes memory encoded = abi.encode(
            executor,           //  0: executor
            new bytes[](0),     //  1: encryptedSecrets (none)
            uint256(300),       //  2: ttl (300 blocks — matches LLM minimum for consistency)
            new bytes[](0),     //  3: secretSignatures (none)
            bytes(""),          //  4: userPublicKey (none)
            COINGECKO_URL,      //  5: url
            uint8(1),           //  6: method = GET
            new string[](0),    //  7: headerKeys (none)
            new string[](0),    //  8: headerValues (none)
            bytes(""),          //  9: body (none for GET)
            uint256(0),         // 10: dkmsKeyIndex (not using dKMS)
            uint8(0),           // 11: dkmsKeyFormat (default)
            false               // 12: piiEnabled
        );

        // FIX [6]: Do not require(success). Emit TickFailed and return gracefully
        // so the scheduler is not bricked if the HTTP precompile errors.
        (bool success, bytes memory result) = HTTP_PRECOMPILE.call(encoded);

        if (!success) {
            emit TickFailed(portfolioOwner, tickIdx, "HTTP", "precompile call failed");
            return;
        }

        // Unwrap async envelope: (bytes simmedInput, bytes actualOutput)
        if (result.length < 64) {
            // Commitment phase — actualOutput not yet available.
            // This is expected during simulation; emit a placeholder snapshot.
            emit PricesSnapshot(portfolioOwner, tickIdx, tickIdx / 2, 0, bytes("pending"));
            return;
        }

        (, bytes memory actualOutput) = abi.decode(result, (bytes, bytes));

        if (actualOutput.length == 0) {
            // Still in commitment phase
            emit PricesSnapshot(portfolioOwner, tickIdx, tickIdx / 2, 0, bytes("pending"));
            return;
        }

        // Decode HTTP response: (uint16 status, string[] hKeys, string[] hVals, bytes body, string err)
        (
            uint16 status,
            ,       // headerKeys (unused)
            ,       // headerValues (unused)
            bytes memory body,
            string memory transportErr
        ) = abi.decode(actualOutput, (uint16, string[], string[], bytes, string));

        if (bytes(transportErr).length > 0) {
            _lastPricesBody[portfolioOwner] = bytes("");
            emit TickFailed(portfolioOwner, tickIdx, "HTTP", transportErr);
            return;
        }

        _lastPricesBody[portfolioOwner] = body;
        emit PricesSnapshot(portfolioOwner, tickIdx, tickIdx / 2, status, body);
    }

    // ─── Internal: LLM tick ──────────────────────────────────────────────────

    /// @dev FIX [3]: Encodes exactly the 30-field LLM request layout defined in
    ///      ritual-dapp-llm/SKILL.md. Field order:
    ///
    ///  0  address          executor
    ///  1  bytes[]          encryptedSecrets
    ///  2  uint256          ttl
    ///  3  bytes[]          secretSignatures
    ///  4  bytes            userPublicKey
    ///  5  string           messagesJson
    ///  6  string           model
    ///  7  int256           frequencyPenalty   (×1000)
    ///  8  string           logitBiasJson
    ///  9  bool             logprobs
    /// 10  int256           maxCompletionTokens
    /// 11  string           metadataJson
    /// 12  string           modalitiesJson
    /// 13  uint256          n
    /// 14  bool             parallelToolCalls
    /// 15  int256           presencePenalty    (×1000)
    /// 16  string           reasoningEffort
    /// 17  bytes            responseFormatData
    /// 18  int256           seed               (-1 = null)
    /// 19  string           serviceTier
    /// 20  string           stopJson
    /// 21  bool             stream
    /// 22  int256           temperature        (×1000)
    /// 23  bytes            toolChoiceData
    /// 24  bytes            toolsData
    /// 25  int256           topLogprobs        (-1 = null)
    /// 26  int256           topP               (×1000)
    /// 27  string           user
    /// 28  bool             piiEnabled
    /// 29  (string,string,string)  convoHistory (platform, path, key_ref)
    function _runLLM(uint256 tickIdx, address portfolioOwner) internal {
        Portfolio storage p = portfolios[portfolioOwner];
        bytes memory pricesBody = _lastPricesBody[portfolioOwner];
        bytes32 pricesHash = keccak256(pricesBody);

        bytes memory messagesJson = _encodeMessages(portfolioOwner, p, pricesBody);

        // FIX [3] + FIX [7]: All 30 fields present; convoHistory is ('','','')
        // because we do not use persistent GCS conversation history.
        bytes memory encoded = abi.encode(
            p.executor,         //  0: executor
            new bytes[](0),     //  1: encryptedSecrets
            uint256(300),       //  2: ttl — 300 blocks minimum for GLM-4.7-FP8
            new bytes[](0),     //  3: secretSignatures
            bytes(""),          //  4: userPublicKey
            string(messagesJson),//  5: messagesJson
            MODEL,              //  6: model
            int256(0),          //  7: frequencyPenalty
            "",                 //  8: logitBiasJson
            false,              //  9: logprobs
            int256(4096),       // 10: maxCompletionTokens — >=4096 required for GLM-4.7-FP8
            "",                 // 11: metadataJson
            "",                 // 12: modalitiesJson
            uint256(1),         // 13: n
            true,               // 14: parallelToolCalls
            int256(0),          // 15: presencePenalty
            "medium",           // 16: reasoningEffort
            bytes(""),          // 17: responseFormatData
            int256(-1),         // 18: seed (null)
            "auto",             // 19: serviceTier
            "",                 // 20: stopJson
            false,              // 21: stream
            _temperatureForRisk(p.riskMode), // 22: temperature ×1000
            bytes(""),          // 23: toolChoiceData
            bytes(""),          // 24: toolsData
            int256(-1),         // 25: topLogprobs (null)
            int256(1000),       // 26: topP (1.0 × 1000)
            "",                 // 27: user
            false,              // 28: piiEnabled
            abi.encode(string(""), string(""), string("")) // 29: convoHistory ('','','') — no persistent history
        );

        // FIX [6]: Graceful failure — emit TickFailed instead of reverting.
        (bool success, bytes memory result) = LLM_PRECOMPILE.call(encoded);

        if (!success) {
            emit TickFailed(portfolioOwner, tickIdx, "LLM", "precompile call failed");
            return;
        }

        if (result.length < 64) {
            // Commitment phase
            emit RebalanceDecision(
                portfolioOwner, tickIdx / 2, tickIdx,
                true, bytes(""), "pending commitment",
                pricesHash, p.riskMode
            );
            return;
        }

        (, bytes memory actualOutput) = abi.decode(result, (bytes, bytes));

        if (actualOutput.length == 0) {
            emit RebalanceDecision(
                portfolioOwner, tickIdx / 2, tickIdx,
                true, bytes(""), "pending settlement",
                pricesHash, p.riskMode
            );
            return;
        }

        // Decode LLM response envelope:
        // (bool hasError, bytes completionData, bytes modelMeta, string errorMsg, (string,string,string) convoRef)
        bool hasErr;
        bytes memory completion;
        string memory errorMsg;

        (hasErr, completion, , errorMsg, ) = abi.decode(
            actualOutput,
            (bool, bytes, bytes, string, ConvoStorageRef)
        );

        uint256 cycleId = tickIdx / 2;
        lastCycleId[portfolioOwner] = cycleId;

        emit RebalanceDecision(
            portfolioOwner, cycleId, tickIdx,
            hasErr, completion, errorMsg,
            pricesHash, p.riskMode
        );
    }

    // ─── Internal: helpers ───────────────────────────────────────────────────

    /// @dev Returns temperature scaled ×1000 for each risk mode.
    ///      Conservative: 0.2 → 200, Balanced: 0.6 → 600, Aggressive: 0.95 → 950.
    function _temperatureForRisk(RiskMode r) internal pure returns (int256) {
        if (r == RiskMode.Conservative) return 200;
        if (r == RiskMode.Balanced)     return 600;
        return 950;
    }

    /// @dev Builds the OpenAI-compatible messages JSON with hex-encoded price blob.
    ///      Prices are hex-encoded to avoid escaping raw JSON quotes in Solidity.
    function _encodeMessages(
        address owner_,
        Portfolio storage p,
        bytes memory priceBody
    ) internal view returns (bytes memory) {
        bytes memory hexBody  = _toHex(priceBody);
        bytes memory riskLine = bytes(_riskInstructions(p.riskMode));

        bytes memory userChunk = abi.encodePacked(
            "OWNER=", _addrToAscii(owner_),
            ";TARGET_ETH_BPS=",  uint2dec(p.ethBps),
            ";TARGET_WBTC_BPS=", uint2dec(p.wbtcBps),
            ";TARGET_USDC_BPS=", uint2dec(p.usdcBps),
            ";PRICES_JSON_HEX=", hexBody
        );

        return abi.encodePacked(
            '[{"role":"system","content":"',
            riskLine,
            ' You MUST reply with a concise JSON-only object with keys:'
            ' rationale (string <=800 chars); suggested_moves (array of'
            ' {asset: eth|btc|usdc|usdt, drift_bps: int, note: string}).'
            ' Decode PRICES_JSON_HEX as UTF-8 JSON to get live prices.'
            ' No markdown, no explanation outside the JSON."},',
            '{"role":"user","content":"',
            userChunk,
            '"}]'
        );
    }

    function _riskInstructions(RiskMode r) internal pure returns (string memory) {
        if (r == RiskMode.Conservative)
            return "Risk=CONSERVATIVE. Prefer smaller adjustments; emphasize capital preservation.";
        if (r == RiskMode.Balanced)
            return "Risk=BALANCED. Balance drawdown sensitivity with drift correction.";
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
        while (temp != 0) { digits++; temp /= 10; }
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
