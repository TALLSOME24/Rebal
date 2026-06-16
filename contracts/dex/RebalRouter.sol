// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRebalFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IRebalPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 ts);
    function mint(address to) external returns (uint256 liquidity);
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external;
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title RebalRouter — Uniswap V2-compatible router for Rebal DEX
/// @dev Uses factory.getPair() lookups instead of CREATE2 hash computation.
///      All-ERC20 (no ETH/WETH wrapping) since tokens on Ritual Chain are mock ERC20s.
contract RebalRouter {
    address public immutable factory;

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "RebalRouter: EXPIRED");
        _;
    }

    constructor(address _factory) {
        factory = _factory;
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        pair = IRebalFactory(factory).getPair(tokenA, tokenB);
        require(pair != address(0), "RebalRouter: PAIR_NOT_FOUND");
    }

    function _getReserves(address tokenA, address tokenB)
        internal view
        returns (uint256 reserveA, uint256 reserveB, address pair)
    {
        pair = _pairFor(tokenA, tokenB);
        (uint112 r0, uint112 r1,) = IRebalPair(pair).getReserves();
        (reserveA, reserveB) = tokenA == IRebalPair(pair).token0()
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));
    }

    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        internal pure returns (uint256 amountB)
    {
        require(amountA > 0, "RebalRouter: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "RebalRouter: INSUFFICIENT_LIQUIDITY");
        amountB = amountA * reserveB / reserveA;
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal pure returns (uint256 amountOut)
    {
        require(amountIn > 0, "RebalRouter: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "RebalRouter: INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 997;
        amountOut = amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee);
    }

    function _getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        internal pure returns (uint256 amountIn)
    {
        require(amountOut > 0, "RebalRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "RebalRouter: INSUFFICIENT_LIQUIDITY");
        amountIn = (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1;
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "RebalRouter: TRANSFER_FAILED");
    }

    // ─── View functions ──────────────────────────────────────────────────────

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        external pure returns (uint256)
    {
        return _quote(amountA, reserveA, reserveB);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "RebalRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint256 rIn, uint256 rOut,) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], rIn, rOut);
        }
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "RebalRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 rIn, uint256 rOut,) = _getReserves(path[i - 1], path[i]);
            amounts[i - 1] = _getAmountIn(amounts[i], rIn, rOut);
        }
    }

    // ─── Liquidity functions ─────────────────────────────────────────────────

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (IRebalFactory(factory).getPair(tokenA, tokenB) == address(0)) {
            IRebalFactory(factory).createPair(tokenA, tokenB);
        }
        (uint256 rA, uint256 rB, address pair) = _getReserves(tokenA, tokenB);

        if (rA == 0 && rB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOpt = _quote(amountADesired, rA, rB);
            if (amountBOpt <= amountBDesired) {
                require(amountBOpt >= amountBMin, "RebalRouter: INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (amountADesired, amountBOpt);
            } else {
                uint256 amountAOpt = _quote(amountBDesired, rB, rA);
                require(amountAOpt <= amountADesired);
                require(amountAOpt >= amountAMin, "RebalRouter: INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (amountAOpt, amountBDesired);
            }
        }
        _safeTransferFrom(tokenA, msg.sender, pair, amountA);
        _safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = IRebalPair(pair).mint(to);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        (,, address pair) = _getReserves(tokenA, tokenB);
        IRebalPair(pair).transferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IRebalPair(pair).burn(to);
        address token0 = IRebalPair(pair).token0();
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, "RebalRouter: INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "RebalRouter: INSUFFICIENT_B_AMOUNT");
    }

    // ─── Swap functions ──────────────────────────────────────────────────────

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2, "RebalRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint256 rIn, uint256 rOut,) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], rIn, rOut);
        }
        require(amounts[amounts.length - 1] >= amountOutMin, "RebalRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _executeSwaps(path, amounts, to);
    }

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2, "RebalRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 rIn, uint256 rOut,) = _getReserves(path[i - 1], path[i]);
            amounts[i - 1] = _getAmountIn(amounts[i], rIn, rOut);
        }
        require(amounts[0] <= amountInMax, "RebalRouter: EXCESSIVE_INPUT_AMOUNT");

        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _executeSwaps(path, amounts, to);
    }

    function _executeSwaps(address[] calldata path, uint256[] memory amounts, address to) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            address currentPair = _pairFor(path[i], path[i + 1]);
            address token0 = IRebalPair(currentPair).token0();
            (uint256 out0, uint256 out1) = path[i] == token0
                ? (uint256(0), amounts[i + 1])
                : (amounts[i + 1], uint256(0));
            address recipient = i < path.length - 2
                ? _pairFor(path[i + 1], path[i + 2])
                : to;
            IRebalPair(currentPair).swap(out0, out1, recipient);
        }
    }
}
