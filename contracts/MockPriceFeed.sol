// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRitualWalletForMockPriceFeed {
    function depositFor(address user, uint256 lockDuration) external payable;
}

contract MockPriceFeed {
    address public constant HTTP_PRECOMPILE = 0x0000000000000000000000000000000000000801;
    address public constant RITUAL_WALLET = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;

    string public constant COINGECKO_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,usd-coin,tether&vs_currencies=usd";

    bytes public latestBody;
    uint16 public latestStatus;
    string public latestError;
    uint256 public latestUpdatedAt;

    event PricesFetched(uint16 statusCode, bytes body, string errorMessage);
    event FeesDeposited(address indexed user, uint256 amountWei, uint256 lockDuration);

    function depositFeesForCaller(uint256 lockDurationBlocks) external payable {
        require(msg.value > 0, "value");
        IRitualWalletForMockPriceFeed(RITUAL_WALLET).depositFor{value: msg.value}(msg.sender, lockDurationBlocks);
        emit FeesDeposited(msg.sender, msg.value, lockDurationBlocks);
    }

    function fetchPrices(address executor, uint256 ttl) external returns (uint16 statusCode, bytes memory body) {
        require(executor != address(0), "executor");
        bytes memory input = abi.encode(
            executor,
            new bytes[](0),
            ttl,
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

        (bool ok, bytes memory rawOutput) = HTTP_PRECOMPILE.call(input);
        require(ok, "http call failed");

        (, bytes memory actualOutput) = abi.decode(rawOutput, (bytes, bytes));
        string[] memory headerKeys;
        string[] memory headerValues;
        (statusCode, headerKeys, headerValues, body, latestError) =
            abi.decode(actualOutput, (uint16, string[], string[], bytes, string));

        latestStatus = statusCode;
        latestBody = body;
        latestUpdatedAt = block.timestamp;

        emit PricesFetched(statusCode, body, latestError);
    }
}
