// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Immutable HookGuard risk oracle.
/// @notice Stores a 0-100 risk score and publish timestamp for each hook.
/// @dev Publisher is immutable; there are no upgrade or admin hooks.
contract HookGuardOracle {
    struct Record {
        uint48 score;
        uint48 updatedAt;
        uint160 extra;
    }

    error NotAuthorized();
    error InvalidScore();
    error EmptyHook();

    address public immutable publisher;
    mapping(address hook => Record record) private records;

    event RiskPublished(address indexed hook, uint256 score, uint256 timestamp);

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert NotAuthorized();
        _;
    }

    constructor(address initialPublisher) {
        if (initialPublisher == address(0)) revert NotAuthorized();
        publisher = initialPublisher;
    }

    function publishRisk(address hook, uint48 score) external onlyPublisher {
        if (hook == address(0)) revert EmptyHook();
        if (score > 100) revert InvalidScore();
        unchecked {
            records[hook] = Record({ score: score, updatedAt: uint48(block.timestamp), extra: 0 });
        }
        emit RiskPublished(hook, score, block.timestamp);
    }

    /// @notice Returns score and timestamp in a single storage read.
    function getRisk(address hook) external view returns (uint256 packed) {
        Record memory record = records[hook];
        return (uint256(record.score) << 48) | record.updatedAt;
    }

    function decode(uint256 packed) external pure returns (uint48 score, uint48 updatedAt) {
        return (uint48(packed >> 48), uint48(packed & ((1 << 48) - 1)));
    }
}
