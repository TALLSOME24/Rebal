// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Minimal ERC20 interface needed for balance/transfer checks
interface IERC20Pair {
    function balanceOf(address) external view returns (uint256);
}

/// @title RebalPair — Uniswap V2-compatible CPAMM pair with ERC20 LP tokens
/// @dev No price oracle accumulators (not needed for MVP), no protocol fee.
///      0.3% swap fee. Reentrancy protected.
contract RebalPair {
    // ─── ERC20 LP token ─────────────────────────────────────────────────────
    string  public constant name     = "Rebal LP";
    string  public constant symbol   = "RLP";
    uint8   public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ─── Pair state ──────────────────────────────────────────────────────────
    address public factory;
    address public token0;
    address public token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32  private blockTimestampLast;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In, uint256 amount1In,
        uint256 amount0Out, uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    // ─── Reentrancy guard ───────────────────────────────────────────────────
    uint256 private _unlocked = 1;
    modifier lock() {
        require(_unlocked == 1, "RebalPair: LOCKED");
        _unlocked = 0;
        _;
        _unlocked = 1;
    }

    constructor() {
        factory = msg.sender;
    }

    /// @notice Called once by the factory immediately after deployment.
    function initialize(address _token0, address _token1) external {
        require(msg.sender == factory, "RebalPair: FORBIDDEN");
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves()
        public view
        returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "RebalPair: TRANSFER_FAILED");
    }

    function _update(uint256 balance0, uint256 balance1) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "RebalPair: OVERFLOW");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(uint112(balance0), uint112(balance1));
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 x, uint256 y) private pure returns (uint256) {
        return x < y ? x : y;
    }

    // ─── Core AMM functions ─────────────────────────────────────────────────

    /// @notice Add liquidity — caller must transfer tokens into pair first.
    function mint(address to) external lock returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        uint256 balance0 = IERC20Pair(token0).balanceOf(address(this));
        uint256 balance1 = IERC20Pair(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mintLP(address(1), MINIMUM_LIQUIDITY); // permanently lock MINIMUM_LIQUIDITY
        } else {
            liquidity = _min(
                amount0 * _totalSupply / _reserve0,
                amount1 * _totalSupply / _reserve1
            );
        }
        require(liquidity > 0, "RebalPair: INSUFFICIENT_LIQUIDITY_MINTED");
        _mintLP(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Remove liquidity — caller must transfer LP tokens into pair first.
    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        address _token0 = token0;
        address _token1 = token1;
        uint256 balance0 = IERC20Pair(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20Pair(_token1).balanceOf(address(this));
        uint256 liquidity = balanceOf[address(this)];

        uint256 _totalSupply = totalSupply;
        amount0 = liquidity * balance0 / _totalSupply;
        amount1 = liquidity * balance1 / _totalSupply;
        require(amount0 > 0 && amount1 > 0, "RebalPair: INSUFFICIENT_LIQUIDITY_BURNED");
        _burnLP(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);
        _update(
            IERC20Pair(_token0).balanceOf(address(this)),
            IERC20Pair(_token1).balanceOf(address(this))
        );
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Swap tokens. Caller specifies exact output amounts (one must be 0).
    ///         Caller must transfer input tokens in before calling.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external lock {
        require(amount0Out > 0 || amount1Out > 0, "RebalPair: INSUFFICIENT_OUTPUT_AMOUNT");
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "RebalPair: INSUFFICIENT_LIQUIDITY");

        address _token0 = token0;
        address _token1 = token1;
        require(to != _token0 && to != _token1, "RebalPair: INVALID_TO");
        if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out);
        if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out);

        uint256 balance0 = IERC20Pair(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20Pair(_token1).balanceOf(address(this));

        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "RebalPair: INSUFFICIENT_INPUT_AMOUNT");

        // Verify CPAMM invariant with 0.3% fee: (b0*1000 - in0*3) * (b1*1000 - in1*3) >= r0*r1*1e6
        {
            uint256 b0adj = balance0 * 1000 - amount0In * 3;
            uint256 b1adj = balance1 * 1000 - amount1In * 3;
            require(
                b0adj * b1adj >= uint256(_reserve0) * uint256(_reserve1) * 1_000_000,
                "RebalPair: K"
            );
        }

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // ─── ERC20 LP token functions ────────────────────────────────────────────

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transferLP(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _transferLP(from, to, value);
        return true;
    }

    function _transferLP(address from, address to, uint256 value) internal {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mintLP(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burnLP(address from, uint256 value) internal {
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }
}
