// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PortfolioAgent.sol";

contract PortfolioAgentFactory {
    address public immutable factoryOwner;
    address public dexRouter;

    mapping(address => address) public agentOf;
    address[] public allAgents;

    event AgentDeployed(address indexed user, address indexed agent);
    event AgentOverridden(address indexed user, address indexed agent);

    constructor(address _dexRouter) {
        factoryOwner = msg.sender;
        dexRouter = _dexRouter;
    }

    function deployAgent() external returns (address) {
        require(agentOf[msg.sender] == address(0), "Agent already deployed");
        PortfolioAgent agent = new PortfolioAgent(msg.sender, dexRouter);
        agentOf[msg.sender] = address(agent);
        allAgents.push(address(agent));
        emit AgentDeployed(msg.sender, address(agent));
        return address(agent);
    }

    function setDexRouter(address _router) external {
        require(msg.sender == factoryOwner, "not owner");
        dexRouter = _router;
    }

    function getAgent(address user) external view returns (address) {
        return agentOf[user];
    }

    function hasAgent(address user) external view returns (bool) {
        return agentOf[user] != address(0);
    }

    /// @notice Admin: remap user → agent (e.g. after a manual deploy outside the factory).
    function overrideAgent(address user, address agent) external {
        require(msg.sender == factoryOwner, "not owner");
        require(agent != address(0), "zero agent");
        agentOf[user] = agent;
        allAgents.push(agent);
        emit AgentOverridden(user, agent);
    }
}
