// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PortfolioAgent.sol";

contract PortfolioAgentFactory {
    mapping(address => address) public agentOf;
    address[] public allAgents;

    event AgentDeployed(address indexed user, address indexed agent);

    function deployAgent() external returns (address) {
        require(agentOf[msg.sender] == address(0), "Agent already deployed");
        PortfolioAgent agent = new PortfolioAgent(msg.sender);
        agentOf[msg.sender] = address(agent);
        allAgents.push(address(agent));
        emit AgentDeployed(msg.sender, address(agent));
        return address(agent);
    }

    function getAgent(address user) external view returns (address) {
        return agentOf[user];
    }

    function hasAgent(address user) external view returns (bool) {
        return agentOf[user] != address(0);
    }
}
