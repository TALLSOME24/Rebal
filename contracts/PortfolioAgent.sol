// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PortfolioAgent v9 — on-chain rebalancing with Rebal DEX integration
/// @notice Uses HTTP 0x0801 for live quotes, LLM 0x0802 for reasoning.
///         Alternating ticks: even = HTTP prices, odd = LLM reasoning.
///         v9: DEX router wired; _doRebalance executes swaps on LLM tick.
///
/// FIXES applied:
///   [1] tickIndex mapping — per-user counter (scheduler always sends index 0)
///   [2] HTTP abi.encode — exact 13-field layout
///   [3] LLM abi.encode — exact 30-field layout with convoHistory tuple
///   [4] Gas — 3_000_000 minimum for LLM ticks
///   [5] TTL — 300 block minimum for GLM-4.7-FP8
///   [6] onScheduledTick — graceful error emission (no require(success))
///   [7] _runLLM convoHistory — ConvoStorageRef("","","") directly, not double-encoded
///   [8] _runHttpPrices — uses httpExecutor (capability-0) stored at registration
///   [9] withdrawFees(uint256) — withdraw RitualWallet balance after lock expires
///  [10] withdrawToken / withdrawAll — recover any ERC20 from agent contract
///  [11] dexRouter — Rebal DEX router; auto-rebalance on each LLM tick

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

/// @dev StorageRef tuple for LLM convoHistory field (field 30).
struct ConvoStorageRef {
    string platform;
    string path;
    string creds;
}

// ─── Contract ─────────────────────────────────────────────────────────────────

contract PortfolioAgent {
    // ─── Precompile addresses ────────────────────────────────────────────────
    address public constant HTTP_PRECOMPILE = 0x0000000000000000000000000000000000000801;
    address public constant LLM_PRECOMPILE  = 0x0000000000000000000000000000000000000802;

    // ─── System contract addresses ───────────────────────────────────────────
    address public constant RITUAL_WALLET   = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;
    address public constant SCHEDULER_CONST = 0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B;

    // ─── Portfolio token addresses (Ritual Chain mock ERC20s) ────────────────
    address public constant WETH_TOKEN = 0xF42c8B335EE1ee9eD84109C68C238E50E0EE27EC;
    address public constant WBTC_TOKEN = 0x9Ca60C0d83EAD718D43C5f2134013e2bA4Ce3ec7;
    address public constant USDC_TOKEN = 0x031CbE4EbC5aF2ca432Ae3df4DbD65053F1A6584;
    address public constant USDT_TOKEN = 0xEa9E6a94E83E4B46eA7Dff6802D269F9a4e21E02;

    IScheduler public immutable scheduler;
    address    public immutable owner;

    /// @notice Rebal DEX router — set at construction, updatable by owner.
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
        address executor;
        uint256 scheduleId;
        address httpExecutor;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────
    mapping(address => Portfolio)  public  portfolios;
    mapping(address => bytes)      internal _lastPricesBody;
    mapping(address => uint256)    public  lastCycleId;
    mapping(address => uint256)    public  tickIndex;

    // ─── Constants ───────────────────────────────────────────────────────────
    string public constant COINGECKO_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,usd-coin&vs_currencies=usd";
    string public constant MODEL = "zai-org/GLM-4.7-FP8";

    // ─── Events ──────────────────────────────────────────────────────────────
    event PortfolioRegistered(address indexed owner, RiskMode risk, uint16 ethBps, uint16 wbtcBps, uint16 usdcBps);
    event FeesDepositFor(address indexed user, uint256 amountWei);
    event AutomationScheduled(address indexed owner, uint256 indexed callId, uint32 frequency, uint32 numCalls);
    event AutomationCancelled(address indexed owner, uint256 indexed callId);
    event PricesSnapshot(address indexed owner, uint256 indexed tickIdx, uint256 indexed cycleId, uint16 statusCode, bytes body);
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

    /// @notice Deposit ERC20 tokens into the agent contract for auto-rebalancing.
    ///         Caller must approve this contract first.
    function depositToken(address token, uint256 amount) external {
        require(amount > 0, "amount required");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit TokenDeposited(token, msg.sender, amount);
    }

    /// @notice Withdraw any ERC20 token from the agent contract to the owner.
    ///         Pass 0 to withdraw the full balance.
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 amt = amount == 0 ? bal : amount;
        require(amt > 0 && amt <= bal, "nothing to withdraw");
        require(IERC20(token).transfer(owner, amt), "transfer failed");
        emit TokenWithdrawn(token, owner, amt);
    }

    /// @notice Withdraw the entire balance of a token to the owner.
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

    /// @notice Withdraw RITUAL from this contract's RitualWallet balance to the owner.
    ///         Lock must have expired. Pass 0 to withdraw full balance.
    function withdrawFees(uint256 amount) external onlyOwner {
        uint256 bal = IRitualWallet(RITUAL_WALLET).balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        uint256 amt = amount == 0 ? bal : amount;
        IRitualWallet(RITUAL_WALLET).withdraw(amt);
        (bool ok,) = owner.call{value: amt}("");
        require(ok, "transfer failed");
    }

    /// @notice Alias for withdrawFees with explicit naming.
    function withdrawRitualFees(uint256 amount) external onlyOwner {
        uint256 bal = IRitualWallet(RITUAL_WALLET).balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        uint256 amt = amount == 0 ? bal : amount;
        IRitualWallet(RITUAL_WALLET).withdraw(amt);
        (bool ok,) = owner.call{value: amt}("");
        require(ok, "transfer failed");
    }

    /// @notice Withdraw the full RitualWallet balance to the owner in one call.
    function withdrawAllRitualFees() external onlyOwner {
        uint256 bal = IRitualWallet(RITUAL_WALLET).balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        IRitualWallet(RITUAL_WALLET).withdraw(bal);
        (bool ok,) = owner.call{value: bal}("");
        require(ok, "transfer failed");
    }

    // ─── Portfolio management ─────────────────────────────────────────────────

    function registerPortfolio(
        RiskMode risk,
        uint16 ethBps_,
        uint16 wbtcBps_,
        uint16 usdcBps_,
        address executor,
        address httpExecutor_
    ) external {
        require(ethBps_ + wbtcBps_ + usdcBps_ <= 10_000, "bps overflow");
        require(executor != address(0), "executor required");
        require(httpExecutor_ != address(0), "httpExecutor required");

        Portfolio storage p = portfolios[msg.sender];
        p.registered   = true;
        p.riskMode     = risk;
        p.ethBps       = ethBps_;
        p.wbtcBps      = wbtcBps_;
        p.usdcBps      = usdcBps_;
        p.executor     = executor;
        p.httpExecutor = httpExecutor_;

        emit PortfolioRegistered(msg.sender, risk, ethBps_, wbtcBps_, usdcBps_);
    }

    // ─── Automation ───────────────────────────────────────────────────────────

    function startAutomation(
        uint32 frequencyBlocks,
        uint32 numCycles,
        uint32 gasLimit,
        uint256 maxFeePerGas,
        uint32 schedulerTtl
    ) external {
        Portfolio storage p = portfolios[msg.sender];
        require(p.registered,             "portfolio not registered");
        require(p.executor != address(0), "executor not set");
        require(numCycles >= 1,           "need at least 1 cycle");
        require(gasLimit >= 3_000_000,    "gasLimit too low: min 3_000_000");
        require(schedulerTtl >= MIN_TTL_BLOCKS, "ttl too low: min 300 blocks");

        uint32 totalRuns = numCycles * 2;
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

        tickIndex[msg.sender] = 0;

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
            address(this)
        );

        p.scheduleId = callId;
        emit AutomationScheduled(msg.sender, callId, frequencyBlocks, totalRuns);
    }

    function cancelAutomation() external {
        Portfolio storage p = portfolios[msg.sender];
        require(p.scheduleId != 0, "no active schedule");
        scheduler.cancel(p.scheduleId);
        emit AutomationCancelled(msg.sender, p.scheduleId);
        p.scheduleId = 0;
    }

    function lastPricesBody(address owner_) external view returns (bytes memory) {
        return _lastPricesBody[owner_];
    }

    // ─── Scheduler callback ───────────────────────────────────────────────────

    function onScheduledTick(
        uint256, /* executionIndex — ignored */
        address portfolioOwner
    ) external onlyScheduler {
        Portfolio storage p = portfolios[portfolioOwner];
        require(p.registered && p.executor != address(0), "portfolio not found");

        uint256 idx = tickIndex[portfolioOwner];
        tickIndex[portfolioOwner] = idx + 1;

        if (idx % 2 == 0) {
            _runHttpPrices(idx, portfolioOwner);
        } else {
            _runLLM(idx, portfolioOwner);
        }
    }

    // ─── HTTP tick ────────────────────────────────────────────────────────────

    function _runHttpPrices(uint256 tickIdx, address portfolioOwner) internal {
        address httpExecutor = portfolios[portfolioOwner].httpExecutor;
        if (httpExecutor == address(0)) {
            emit TickFailed(portfolioOwner, tickIdx, "HTTP", "httpExecutor not set");
            return;
        }

        bytes memory encoded = abi.encode(
            httpExecutor,
            new bytes[](0),
            uint256(300),
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

        if (!success) {
            emit TickFailed(portfolioOwner, tickIdx, "HTTP", "precompile call failed");
            return;
        }

        if (result.length < 64) {
            emit PricesSnapshot(portfolioOwner, tickIdx, tickIdx / 2, 0, bytes("pending"));
            return;
        }

        (, bytes memory actualOutput) = abi.decode(result, (bytes, bytes));

        if (actualOutput.length == 0) {
            emit PricesSnapshot(portfolioOwner, tickIdx, tickIdx / 2, 0, bytes("pending"));
            return;
        }

        (
            uint16 status,
            ,
            ,
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

    // ─── LLM tick ─────────────────────────────────────────────────────────────

    function _runLLM(uint256 tickIdx, address portfolioOwner) internal {
        Portfolio storage p = portfolios[portfolioOwner];
        bytes memory pricesBody = _lastPricesBody[portfolioOwner];
        bytes32 pricesHash = keccak256(pricesBody);

        bytes memory messagesJson = _encodeMessages(portfolioOwner, p, pricesBody);

        bytes memory encoded = abi.encode(
            p.executor,
            new bytes[](0),
            uint256(300),
            new bytes[](0),
            bytes(""),
            string(messagesJson),
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
            "medium",
            bytes(""),
            int256(-1),
            "auto",
            "",
            false,
            _temperatureForRisk(p.riskMode),
            bytes(""),
            bytes(""),
            int256(-1),
            int256(1000),
            "",
            false,
            ConvoStorageRef("", "", "")
        );

        (bool success, bytes memory result) = LLM_PRECOMPILE.call(encoded);

        if (!success) {
            emit TickFailed(portfolioOwner, tickIdx, "LLM", "precompile call failed");
            return;
        }

        if (result.length < 64) {
            emit RebalanceDecision(portfolioOwner, tickIdx / 2, tickIdx, true, bytes(""), "pending commitment", pricesHash, p.riskMode);
            return;
        }

        (, bytes memory actualOutput) = abi.decode(result, (bytes, bytes));

        if (actualOutput.length == 0) {
            emit RebalanceDecision(portfolioOwner, tickIdx / 2, tickIdx, true, bytes(""), "pending settlement", pricesHash, p.riskMode);
            return;
        }

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

        // [11] Auto-rebalance: if LLM succeeded and DEX router is configured,
        //      compare actual allocations to target and execute the largest needed swap.
        if (!hasErr && dexRouter != address(0)) {
            _doRebalance(portfolioOwner, p);
        }
    }

    // ─── DEX rebalance ────────────────────────────────────────────────────────

    /// @dev Compares actual token balances to target allocation and executes
    ///      a single swap to correct the largest drift. Uses WETH as the
    ///      routing hub for non-WETH pairs.
    function _doRebalance(address portfolioOwner, Portfolio storage p) internal {
        uint256 wethBal = IERC20(WETH_TOKEN).balanceOf(address(this));
        uint256 wbtcBal = IERC20(WBTC_TOKEN).balanceOf(address(this));
        uint256 usdcBal = IERC20(USDC_TOKEN).balanceOf(address(this));
        uint256 usdtBal = IERC20(USDT_TOKEN).balanceOf(address(this));

        // Skip if nothing to rebalance
        if (wethBal == 0 && wbtcBal == 0 && usdcBal == 0 && usdtBal == 0) return;

        // Get WETH price in USDC (1 WETH → X USDC, 6 decimals)
        address[] memory path2 = new address[](2);
        path2[0] = WETH_TOKEN;
        path2[1] = USDC_TOKEN;
        uint256 wethPriceUsdc;
        try IUniswapV2Router(dexRouter).getAmountsOut(1e18, path2)
            returns (uint256[] memory out) {
            wethPriceUsdc = out[1];
        } catch {
            emit TickFailed(portfolioOwner, tickIndex[portfolioOwner], "REBAL", "price fetch failed: WETH/USDC");
            return;
        }
        if (wethPriceUsdc == 0) return;

        // Get WBTC price in USDC via WETH (1 WBTC → X WETH → X USDC)
        uint256 wbtcPriceUsdc;
        if (wbtcBal > 0) {
            path2[0] = WBTC_TOKEN;
            path2[1] = WETH_TOKEN;
            try IUniswapV2Router(dexRouter).getAmountsOut(1e8, path2)
                returns (uint256[] memory out) {
                // out[1] is WETH per 1 WBTC (18 dec); convert to USDC (6 dec)
                wbtcPriceUsdc = out[1] * wethPriceUsdc / 1e18;
            } catch {
                wbtcPriceUsdc = wethPriceUsdc * 20; // fallback: 1 WBTC = 20 WETH
            }
        }

        // Calculate current values in USDC (6 decimals)
        uint256 vWeth = wethBal * wethPriceUsdc / 1e18;
        uint256 vWbtc = wbtcBal > 0 ? wbtcBal * wbtcPriceUsdc / 1e8 : 0;
        uint256 vUsdc = usdcBal;
        uint256 vUsdt = usdtBal;

        uint256 total = vWeth + vWbtc + vUsdc + vUsdt;
        if (total == 0) return;

        // Target values in USDC
        uint16 usdtBps = uint16(10000 - p.ethBps - p.wbtcBps - p.usdcBps);
        uint256 tWeth = total * p.ethBps  / 10000;
        uint256 tWbtc = total * p.wbtcBps / 10000;
        uint256 tUsdc = total * p.usdcBps / 10000;
        uint256 tUsdt = total * usdtBps   / 10000;

        // Signed drifts (positive = overweight)
        int256 dWeth = int256(vWeth) - int256(tWeth);
        int256 dWbtc = int256(vWbtc) - int256(tWbtc);
        int256 dUsdc = int256(vUsdc) - int256(tUsdc);
        int256 dUsdt = int256(vUsdt) - int256(tUsdt);

        // Find most overweight token (to sell)
        address tokenIn;
        int256 maxD = int256(1e5); // minimum $0.10 threshold (USDC 6 dec)
        if (dWeth > maxD) { maxD = dWeth; tokenIn = WETH_TOKEN; }
        if (dWbtc > maxD) { maxD = dWbtc; tokenIn = WBTC_TOKEN; }
        if (dUsdc > maxD) { maxD = dUsdc; tokenIn = USDC_TOKEN; }
        if (dUsdt > maxD) { maxD = dUsdt; tokenIn = USDT_TOKEN; }
        if (tokenIn == address(0)) return; // portfolio is balanced

        // Find most underweight token (to buy)
        address tokenOut;
        int256 minD = int256(0);
        if (dWeth < minD) { minD = dWeth; tokenOut = WETH_TOKEN; }
        if (dWbtc < minD) { minD = dWbtc; tokenOut = WBTC_TOKEN; }
        if (dUsdc < minD) { minD = dUsdc; tokenOut = USDC_TOKEN; }
        if (dUsdt < minD) { minD = dUsdt; tokenOut = USDT_TOKEN; }
        if (tokenOut == address(0) || tokenIn == tokenOut) return;

        // Swap half the excess (conservative; multiple ticks converge)
        uint256 swapValueUsdc = uint256(maxD) / 2;

        // Convert USDC value to tokenIn native amount
        uint256 amountIn;
        if      (tokenIn == WETH_TOKEN) amountIn = swapValueUsdc * 1e18 / wethPriceUsdc;
        else if (tokenIn == WBTC_TOKEN) amountIn = wbtcPriceUsdc > 0 ? swapValueUsdc * 1e8 / wbtcPriceUsdc : 0;
        else                            amountIn = swapValueUsdc; // USDC or USDT (6 dec)

        // Cap at available balance
        uint256 maxBal = tokenIn == WETH_TOKEN ? wethBal
                       : tokenIn == WBTC_TOKEN ? wbtcBal
                       : tokenIn == USDC_TOKEN ? usdcBal
                       : usdtBal;
        if (amountIn > maxBal) amountIn = maxBal;
        if (amountIn == 0) return;

        _executeSwap(portfolioOwner, tokenIn, tokenOut, amountIn);
    }

    /// @dev Executes a swap via the Rebal DEX router.
    ///      Uses direct path if one token is WETH, otherwise routes through WETH.
    function _executeSwap(
        address portfolioOwner,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal {
        // Build routing path
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
            0,              // accept any output; allocation logic controls acceptable drift
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
            emit TickFailed(portfolioOwner, tickIndex[portfolioOwner], "SWAP", "swap reverted");
        }
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _temperatureForRisk(RiskMode r) internal pure returns (int256) {
        if (r == RiskMode.Conservative) return 200;
        if (r == RiskMode.Balanced)     return 600;
        return 950;
    }

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

    function _toHex(bytes memory data) internal pure returns (bytes memory) {
        if (data.length == 0) return "0x";
        bytes16 alphabet = "0123456789abcdef";
        bytes memory str = new bytes(2 + data.length * 2);
        str[0] = "0"; str[1] = "x";
        for (uint256 i = 0; i < data.length; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return str;
    }
}
