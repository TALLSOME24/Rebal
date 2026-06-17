// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PortfolioAgent v10 — Sovereign Agent (0x080C) single-tick architecture
/// @notice One scheduled tick submits a ZeroClaw job that fetches prices + reasons
///         about drift in one TEE execution. The AsyncDelivery callback receives the
///         JSON decision and gates _doRebalance on "action":"swap".
///
/// Replaces the HTTP+LLM two-tick model (v9) with a single async tick:
///   onScheduledTick → _callSovereignAgent → 0x080C
///   AsyncDelivery → onSovereignAgentResult → _doRebalance (if swap)

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function depositFor(address user, uint256 lockDuration) external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function lockUntil(address account) external view returns (uint256);
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

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);
}

/// @dev Tuple type for 0x080C convoHistory / output / skills / systemPrompt fields.
struct StorageRef {
    string platform;
    string path;
    string keyRef;
}

// ─── Contract ─────────────────────────────────────────────────────────────────

contract PortfolioAgent {
    // ─── Precompile / system addresses ──────────────────────────────────────
    address public constant SOVEREIGN_AGENT = 0x000000000000000000000000000000000000080C;
    address public constant ASYNC_DELIVERY  = 0x5A16214fF555848411544b005f7Ac063742f39F6;
    address public constant RITUAL_WALLET   = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;
    address public constant SCHEDULER_CONST = 0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B;

    // keccak256("onSovereignAgentResult(bytes32,bytes)")[0:4]
    bytes4  public constant DELIVERY_SELECTOR   = 0x8ca12055;

    // Cap-0 executor from TEEServiceRegistry — fixed for Ritual testnet
    address public constant SOVEREIGN_EXECUTOR  = 0x9dc11412391Dc3EDF59811FC9Ee7bEbFD41c8b4C;

    // ECIES-encrypted {"LLM_PROVIDER":"ritual"} to SOVEREIGN_EXECUTOR pubkey, nonce=12
    bytes   public constant ENCRYPTED_SECRETS   = hex"04ec54f0903cb6dc3b1175794b7596175d1c94fc7ab569121cf19c165fd16cd00fc338ac3a07015f5df6ffc47563aaec2714487fe8b3a3fe20d8b193a8f1e708496af4b702616a44c836d30a9d8e6f1126583896feb9f6ffea2dafb964629b47d33807b77a142d503d2c738374153ae8b4c841c7abc4";

    // ─── Portfolio token addresses (Ritual Chain mock ERC20s) ────────────────
    address public constant WETH_TOKEN = 0xF42c8B335EE1ee9eD84109C68C238E50E0EE27EC;
    address public constant WBTC_TOKEN = 0x9Ca60C0d83EAD718D43C5f2134013e2bA4Ce3ec7;
    address public constant USDC_TOKEN = 0x031CbE4EbC5aF2ca432Ae3df4DbD65053F1A6584;
    address public constant USDT_TOKEN = 0xEa9E6a94E83E4B46eA7Dff6802D269F9a4e21E02;

    IScheduler public immutable scheduler;
    address    public immutable owner;

    address public dexRouter;

    uint32 public constant MIN_TTL_BLOCKS = 300;

    // ─── Types ───────────────────────────────────────────────────────────────
    enum RiskMode { Conservative, Balanced, Aggressive }

    struct Portfolio {
        bool registered;
        RiskMode riskMode;
        uint16 ethBps;
        uint16 wbtcBps;
        uint16 usdcBps;
        address executor;    // sovereign agent executor (TEEServiceRegistry cap=0)
        uint256 scheduleId;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────
    mapping(address => Portfolio) public  portfolios;
    mapping(address => bytes32)   public  pendingJobId;       // in-flight job per owner
    mapping(bytes32  => address)  public  jobOwner;           // reverse lookup for callback
    mapping(address => uint256)   public  lastCycleId;        // incremented on each result

    // ─── Events ──────────────────────────────────────────────────────────────
    event PortfolioRegistered(address indexed owner, RiskMode risk, uint16 ethBps, uint16 wbtcBps, uint16 usdcBps);
    event FeesDepositFor(address indexed user, uint256 amountWei);
    event AutomationScheduled(address indexed owner, uint256 indexed callId, uint32 frequency, uint32 numCalls);
    event AutomationCancelled(address indexed owner, uint256 indexed callId);
    event AutomationTriggered(address indexed owner, bytes32 indexed jobId);
    event SovereignAgentResult(
        address indexed owner,
        bytes32 indexed jobId,
        uint256 cycleId,
        bool    hasError,
        string  textResponse,
        string  errorMessage
    );
    event SwapExecuted(
        address indexed portfolioOwner,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event TickFailed(address indexed owner, uint256 indexed tickIdx, string phase, string reason);
    event TokenDeposited(address indexed token, address indexed from, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyScheduler() {
        require(msg.sender == address(scheduler), "not scheduler");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _owner, address _dexRouter) {
        require(_owner != address(0), "owner required");
        scheduler = IScheduler(SCHEDULER_CONST);
        owner = _owner;
        dexRouter = _dexRouter;
    }

    receive() external payable {}

    // ─── Owner: DEX router ───────────────────────────────────────────────────

    function setDexRouter(address _router) external onlyOwner {
        dexRouter = _router;
    }

    // ─── Token custody: deposit / withdraw ───────────────────────────────────

    function depositToken(address token, uint256 amount) external {
        require(amount > 0, "amount required");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit TokenDeposited(token, msg.sender, amount);
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 amt = amount == 0 ? bal : amount;
        require(amt > 0 && amt <= bal, "nothing to withdraw");
        require(IERC20(token).transfer(owner, amt), "transfer failed");
        emit TokenWithdrawn(token, owner, amt);
    }

    function withdrawAll(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        require(IERC20(token).transfer(owner, bal), "transfer failed");
        emit TokenWithdrawn(token, owner, bal);
    }

    // ─── RitualWallet helpers ─────────────────────────────────────────────────

    function ritualBalance(address user) external view returns (uint256) {
        return IRitualWallet(RITUAL_WALLET).balanceOf(user);
    }

    function contractRitualBalance() external view returns (uint256) {
        return IRitualWallet(RITUAL_WALLET).balanceOf(address(this));
    }

    function depositFeesForCaller(uint256 lockDurationBlocks) external payable {
        require(msg.value > 0, "value required");
        IRitualWallet(RITUAL_WALLET).deposit{value: msg.value}(lockDurationBlocks);
        emit FeesDepositFor(msg.sender, msg.value);
    }

    function withdrawFees(uint256 amount) external onlyOwner {
        uint256 bal = IRitualWallet(RITUAL_WALLET).balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        uint256 amt = amount == 0 ? bal : amount;
        IRitualWallet(RITUAL_WALLET).withdraw(amt);
        (bool ok,) = owner.call{value: amt}("");
        require(ok, "transfer failed");
    }

    function withdrawRitualFees(uint256 amount) external onlyOwner {
        uint256 bal = IRitualWallet(RITUAL_WALLET).balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        uint256 amt = amount == 0 ? bal : amount;
        IRitualWallet(RITUAL_WALLET).withdraw(amt);
        (bool ok,) = owner.call{value: amt}("");
        require(ok, "transfer failed");
    }

    function withdrawAllRitualFees() external onlyOwner {
        uint256 bal = IRitualWallet(RITUAL_WALLET).balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        IRitualWallet(RITUAL_WALLET).withdraw(bal);
        (bool ok,) = owner.call{value: bal}("");
        require(ok, "transfer failed");
    }

    // ─── Portfolio management ─────────────────────────────────────────────────

    /// @notice Register or update your portfolio.
    ///         Encrypted secrets and executor are hardcoded constants (testnet TEE is fixed).
    function registerPortfolio(
        RiskMode risk,
        uint16 ethBps_,
        uint16 wbtcBps_,
        uint16 usdcBps_
    ) external {
        require(ethBps_ + wbtcBps_ + usdcBps_ <= 10_000, "bps overflow");

        Portfolio storage p = portfolios[msg.sender];
        p.registered  = true;
        p.riskMode    = risk;
        p.ethBps      = ethBps_;
        p.wbtcBps     = wbtcBps_;
        p.usdcBps     = usdcBps_;
        p.executor    = SOVEREIGN_EXECUTOR;

        emit PortfolioRegistered(msg.sender, risk, ethBps_, wbtcBps_, usdcBps_);
    }

    // ─── Automation ───────────────────────────────────────────────────────────

    function startAutomation(
        uint32 frequencyBlocks,
        uint32 numCalls,
        uint32 gasLimit,
        uint256 maxFeePerGas,
        uint32 schedulerTtl
    ) external {
        Portfolio storage p = portfolios[msg.sender];
        require(p.registered,             "portfolio not registered");
        require(p.executor != address(0), "executor not set");
        require(numCalls >= 1,            "need at least 1 call");
        require(gasLimit >= 3_000_000,    "gasLimit too low: min 3_000_000");
        require(schedulerTtl >= MIN_TTL_BLOCKS, "ttl too low: min 300 blocks");

        uint256 maxCostPerExecution = uint256(gasLimit) * maxFeePerGas;
        require(
            IRitualWallet(RITUAL_WALLET).balanceOf(address(this)) >= maxCostPerExecution,
            "contract fee balance too low"
        );
        require(
            IRitualWallet(RITUAL_WALLET).lockUntil(address(this)) >= block.number + schedulerTtl,
            "contract fee lock too short"
        );

        if (p.scheduleId != 0) {
            try scheduler.cancel(p.scheduleId) {
                emit AutomationCancelled(msg.sender, p.scheduleId);
            } catch {}
            p.scheduleId = 0;
        }

        bytes memory data = abi.encodeCall(this.onScheduledTick, (uint256(0), msg.sender));

        uint256 callId = scheduler.schedule(
            data,
            gasLimit,
            uint32(block.number + frequencyBlocks),
            numCalls,
            frequencyBlocks,
            schedulerTtl,
            maxFeePerGas,
            0,
            0,
            address(this)
        );

        p.scheduleId = callId;
        emit AutomationScheduled(msg.sender, callId, frequencyBlocks, numCalls);
    }

    function cancelAutomation() external {
        Portfolio storage p = portfolios[msg.sender];
        require(p.scheduleId != 0, "no active schedule");
        scheduler.cancel(p.scheduleId);
        emit AutomationCancelled(msg.sender, p.scheduleId);
        p.scheduleId = 0;
    }

    // ─── Scheduler callback ───────────────────────────────────────────────────

    function onScheduledTick(
        uint256, /* executionIndex — ignored */
        address portfolioOwner
    ) external onlyScheduler {
        // Skip if a sovereign agent job is already outstanding for this owner.
        if (pendingJobId[portfolioOwner] != bytes32(0)) {
            emit TickFailed(portfolioOwner, lastCycleId[portfolioOwner], "SOVEREIGN", "job already in flight");
            return;
        }

        Portfolio storage p = portfolios[portfolioOwner];
        require(p.registered && p.executor != address(0), "portfolio not found");

        bytes32 jobId = _callSovereignAgent(portfolioOwner, p);
        if (jobId == bytes32(0)) return; // _callSovereignAgent already emitted TickFailed

        pendingJobId[portfolioOwner] = jobId;
        jobOwner[jobId]             = portfolioOwner;
        emit AutomationTriggered(portfolioOwner, jobId);
    }

    // ─── AsyncDelivery callback ───────────────────────────────────────────────

    /// @notice Called by AsyncDelivery (0x5A16…) when the sovereign agent job completes.
    ///         selector = keccak256("onSovereignAgentResult(bytes32,bytes)")[0:4] = 0x8ca12055
    function onSovereignAgentResult(bytes32 jobId, bytes calldata result) external {
        require(msg.sender == ASYNC_DELIVERY, "unauthorized callback");

        address portfolioOwner = jobOwner[jobId];
        require(portfolioOwner != address(0), "unknown jobId");

        // Clear pending state before any external calls.
        delete pendingJobId[portfolioOwner];
        delete jobOwner[jobId];

        // Decode the 6-tuple returned by AsyncDelivery.
        bool success;
        string memory errorMsg;
        string memory textResponse;
        {
            StorageRef memory _c;
            StorageRef memory _o;
            StorageRef[] memory _a;
            (success, errorMsg, textResponse, _c, _o, _a) = abi.decode(
                result,
                (bool, string, string, StorageRef, StorageRef, StorageRef[])
            );
        }

        uint256 cycleId = lastCycleId[portfolioOwner];
        lastCycleId[portfolioOwner] = cycleId + 1;

        emit SovereignAgentResult(portfolioOwner, jobId, cycleId, !success, textResponse, errorMsg);

        if (!success) {
            emit TickFailed(portfolioOwner, cycleId, "SOVEREIGN", errorMsg);
            return;
        }

        // Gate rebalance on the agent's explicit "swap" decision.
        if (dexRouter != address(0) && _isSwapAction(textResponse)) {
            _doRebalance(portfolioOwner, portfolios[portfolioOwner]);
        }
    }

    // ─── Sovereign agent call ─────────────────────────────────────────────────

    function _callSovereignAgent(
        address portfolioOwner,
        Portfolio storage p
    ) internal returns (bytes32) {
        string  memory prompt = _buildPrompt(portfolioOwner, p);
        bytes   memory secrets = ENCRYPTED_SECRETS;

        StorageRef    memory emptyRef   = StorageRef("", "", "");
        StorageRef[]  memory emptySkills = new StorageRef[](0);
        string[]      memory emptyTools  = new string[](0);

        bytes memory encoded = abi.encode(
            p.executor,                            // 0:  executor (address)
            uint256(500),                          // 1:  ttl (uint256) — Ritual max
            bytes(""),                             // 2:  userPublicKey (bytes) — empty = plaintext
            uint64(5),                             // 3:  pollIntervalBlocks (uint64)
            uint64(block.number + 6000),           // 4:  maxPollBlock (uint64)
            "SOVEREIGN_AGENT_TASK",                // 5:  taskIdMarker (string)
            address(this),                         // 6:  deliveryTarget (address)
            DELIVERY_SELECTOR,                     // 7:  deliverySelector (bytes4)
            uint256(3_000_000),                    // 8:  deliveryGasLimit (uint256)
            uint256(1_000_000_000),                // 9:  deliveryMaxFeePerGas (1 gwei)
            uint256(100_000_000),                  // 10: deliveryMaxPriorityFeePerGas
            uint16(6),                             // 11: cliType — 6=ZeroClaw
            prompt,                                // 12: prompt (string)
            secrets,                               // 13: encryptedSecrets (bytes)
            emptyRef,                              // 14: convoHistory (StorageRef)
            emptyRef,                              // 15: output (StorageRef)
            emptySkills,                           // 16: skills (StorageRef[])
            emptyRef,                              // 17: systemPrompt (StorageRef)
            "zai-org/GLM-4.7-FP8",                // 18: model (string)
            emptyTools,                            // 19: tools (string[]) — [] = all
            uint16(50),                            // 20: maxTurns (uint16)
            uint32(8192),                          // 21: maxTokens (uint32)
            ""                                     // 22: rpcUrls ("" = executor uses default RPC)
        );

        (bool ok, bytes memory ret) = SOVEREIGN_AGENT.call(encoded);
        if (!ok) {
            emit TickFailed(portfolioOwner, lastCycleId[portfolioOwner], "SOVEREIGN", "0x080C call failed");
            return bytes32(0);
        }

        if (ret.length < 32) {
            emit TickFailed(portfolioOwner, lastCycleId[portfolioOwner], "SOVEREIGN", "no jobId in return data");
            return bytes32(0);
        }

        return abi.decode(ret, (bytes32));
    }

    // ─── Prompt builder ───────────────────────────────────────────────────────

    function _buildPrompt(
        address portfolioOwner,
        Portfolio storage p
    ) internal view returns (string memory) {
        uint16 usdtBps = uint16(10000 - uint256(p.ethBps) - uint256(p.wbtcBps) - uint256(p.usdcBps));

        return string(abi.encodePacked(
            "You are a portfolio rebalancing agent running inside a Ritual TEE.\n"
            "Owner: ", _addrToAscii(portfolioOwner), "\n\n"
            "STEP 1 - Fetch current prices:\n"
            "GET https://api.coingecko.com/api/v3/simple/price"
            "?ids=ethereum,bitcoin,usd-coin&vs_currencies=usd\n\n"
            "STEP 2 - Target allocations (basis points, 10000=100%):\n"
            "  WETH: ", uint2dec(p.ethBps),  " bps\n"
            "  WBTC: ", uint2dec(p.wbtcBps), " bps\n"
            "  USDC: ", uint2dec(p.usdcBps), " bps\n"
            "  USDT: ", uint2dec(usdtBps),   " bps\n"
            "  Risk mode: ", _riskName(p.riskMode), "\n\n"
            "STEP 3 - Decision rules:\n"
            "- If any asset drifts >200 bps from target: recommend ONE swap.\n"
            "- Conservative: prefer smaller corrections. Aggressive: larger steps.\n"
            "- If no asset drifts >200 bps: hold.\n\n"
            "OUTPUT - Respond with ONLY one of these two JSON objects, nothing else:\n"
            "{\"action\":\"hold\",\"reason\":\"<explanation>\",\"confidence\":<0.0-1.0>}\n"
            "{\"action\":\"swap\",\"fromToken\":\"<WETH|WBTC|USDC|USDT>\","
            "\"toToken\":\"<WETH|WBTC|USDC|USDT>\",\"amountBps\":<0-10000>,"
            "\"reason\":\"<explanation>\",\"confidence\":<0.0-1.0>}\n"
            "No markdown. No code blocks. No text before or after the JSON."
        ));
    }

    // ─── Action parser ────────────────────────────────────────────────────────

    function _isSwapAction(string memory text) internal pure returns (bool) {
        bytes memory b = bytes(text);
        return _bytesContains(b, bytes('"action":"swap"'))
            || _bytesContains(b, bytes('"action": "swap"'));
    }

    function _bytesContains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length > haystack.length) return false;
        uint256 limit = haystack.length - needle.length;
        for (uint256 i = 0; i <= limit; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) { found = false; break; }
            }
            if (found) return true;
        }
        return false;
    }

    // ─── DEX rebalance ────────────────────────────────────────────────────────

    function _doRebalance(address portfolioOwner, Portfolio storage p) internal {
        uint256 wethBal = IERC20(WETH_TOKEN).balanceOf(address(this));
        uint256 wbtcBal = IERC20(WBTC_TOKEN).balanceOf(address(this));
        uint256 usdcBal = IERC20(USDC_TOKEN).balanceOf(address(this));
        uint256 usdtBal = IERC20(USDT_TOKEN).balanceOf(address(this));

        if (wethBal == 0 && wbtcBal == 0 && usdcBal == 0 && usdtBal == 0) return;

        address[] memory path2 = new address[](2);
        path2[0] = WETH_TOKEN;
        path2[1] = USDC_TOKEN;
        uint256 wethPriceUsdc;
        try IUniswapV2Router(dexRouter).getAmountsOut(1e18, path2)
            returns (uint256[] memory out) {
            wethPriceUsdc = out[1];
        } catch {
            emit TickFailed(portfolioOwner, lastCycleId[portfolioOwner], "REBAL", "price fetch failed: WETH/USDC");
            return;
        }
        if (wethPriceUsdc == 0) return;

        uint256 wbtcPriceUsdc;
        if (wbtcBal > 0) {
            path2[0] = WBTC_TOKEN;
            path2[1] = WETH_TOKEN;
            try IUniswapV2Router(dexRouter).getAmountsOut(1e8, path2)
                returns (uint256[] memory out) {
                wbtcPriceUsdc = out[1] * wethPriceUsdc / 1e18;
            } catch {
                wbtcPriceUsdc = wethPriceUsdc * 20;
            }
        }

        uint256 vWeth = wethBal * wethPriceUsdc / 1e18;
        uint256 vWbtc = wbtcBal > 0 ? wbtcBal * wbtcPriceUsdc / 1e8 : 0;
        uint256 vUsdc = usdcBal;
        uint256 vUsdt = usdtBal;

        uint256 total = vWeth + vWbtc + vUsdc + vUsdt;
        if (total == 0) return;

        uint16 usdtBps = uint16(10000 - p.ethBps - p.wbtcBps - p.usdcBps);
        uint256 tWeth = total * p.ethBps  / 10000;
        uint256 tWbtc = total * p.wbtcBps / 10000;
        uint256 tUsdc = total * p.usdcBps / 10000;
        uint256 tUsdt = total * usdtBps   / 10000;

        int256 dWeth = int256(vWeth) - int256(tWeth);
        int256 dWbtc = int256(vWbtc) - int256(tWbtc);
        int256 dUsdc = int256(vUsdc) - int256(tUsdc);
        int256 dUsdt = int256(vUsdt) - int256(tUsdt);

        address tokenIn;
        int256 maxD = int256(1e5);
        if (dWeth > maxD) { maxD = dWeth; tokenIn = WETH_TOKEN; }
        if (dWbtc > maxD) { maxD = dWbtc; tokenIn = WBTC_TOKEN; }
        if (dUsdc > maxD) { maxD = dUsdc; tokenIn = USDC_TOKEN; }
        if (dUsdt > maxD) { maxD = dUsdt; tokenIn = USDT_TOKEN; }
        if (tokenIn == address(0)) return;

        address tokenOut;
        int256 minD = int256(0);
        if (dWeth < minD) { minD = dWeth; tokenOut = WETH_TOKEN; }
        if (dWbtc < minD) { minD = dWbtc; tokenOut = WBTC_TOKEN; }
        if (dUsdc < minD) { minD = dUsdc; tokenOut = USDC_TOKEN; }
        if (dUsdt < minD) { minD = dUsdt; tokenOut = USDT_TOKEN; }
        if (tokenOut == address(0) || tokenIn == tokenOut) return;

        uint256 swapValueUsdc = uint256(maxD) / 2;

        uint256 amountIn;
        if      (tokenIn == WETH_TOKEN) amountIn = swapValueUsdc * 1e18 / wethPriceUsdc;
        else if (tokenIn == WBTC_TOKEN) amountIn = wbtcPriceUsdc > 0 ? swapValueUsdc * 1e8 / wbtcPriceUsdc : 0;
        else                            amountIn = swapValueUsdc;

        uint256 maxBal = tokenIn == WETH_TOKEN ? wethBal
                       : tokenIn == WBTC_TOKEN ? wbtcBal
                       : tokenIn == USDC_TOKEN ? usdcBal
                       : usdtBal;
        if (amountIn > maxBal) amountIn = maxBal;
        if (amountIn == 0) return;

        _executeSwap(portfolioOwner, tokenIn, tokenOut, amountIn);
    }

    function _executeSwap(
        address portfolioOwner,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal {
        address[] memory path;
        if (tokenIn == WETH_TOKEN || tokenOut == WETH_TOKEN) {
            path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
        } else {
            path = new address[](3);
            path[0] = tokenIn;
            path[1] = WETH_TOKEN;
            path[2] = tokenOut;
        }

        IERC20(tokenIn).approve(dexRouter, amountIn);

        try IUniswapV2Router(dexRouter).swapExactTokensForTokens(
            amountIn,
            0,
            path,
            address(this),
            block.timestamp + 300_000
        ) returns (uint256[] memory amounts) {
            IERC20(tokenIn).approve(dexRouter, 0);
            emit SwapExecuted(
                portfolioOwner, tokenIn, tokenOut,
                amountIn, amounts[amounts.length - 1]
            );
        } catch {
            IERC20(tokenIn).approve(dexRouter, 0);
            emit TickFailed(portfolioOwner, lastCycleId[portfolioOwner], "SWAP", "swap reverted");
        }
    }

    // ─── Internal string/byte helpers ─────────────────────────────────────────

    function _riskName(RiskMode r) internal pure returns (string memory) {
        if (r == RiskMode.Conservative) return "Conservative";
        if (r == RiskMode.Balanced)     return "Balanced";
        return "Aggressive";
    }

    function _addrToAscii(address a) internal pure returns (bytes memory out) {
        bytes memory alphabet = "0123456789abcdef";
        out = new bytes(42);
        out[0] = "0"; out[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(uint160(a) >> (8 * (19 - i)));
            out[2 + i * 2] = alphabet[b >> 4];
            out[3 + i * 2] = alphabet[b & 0x0f];
        }
    }

    function uint2dec(uint256 v) internal pure returns (bytes memory) {
        if (v == 0) return "0";
        uint256 temp = v; uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return buf;
    }
}
