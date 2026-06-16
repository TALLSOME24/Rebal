// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./RebalPair.sol";

/// @title RebalFactory — Uniswap V2-compatible pair factory
/// @dev Uses CREATE2 for deterministic pair addresses.
///      getPair[token0][token1] where token0 < token1.
contract RebalFactory {
    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 total);

    constructor(address _feeToSetter) {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "RebalFactory: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "RebalFactory: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "RebalFactory: PAIR_EXISTS");

        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        RebalPair newPair = new RebalPair{salt: salt}();
        newPair.initialize(token0, token1);
        pair = address(newPair);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, "RebalFactory: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, "RebalFactory: FORBIDDEN");
        feeToSetter = _feeToSetter;
    }
}
