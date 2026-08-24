// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {HookGuardOracle} from "../src/HookGuardOracle.sol";

contract HookGuardOracleTest is Test {
    HookGuardOracle internal oracle;

    function setUp() public {
        oracle = new HookGuardOracle(address(this));
    }

    function test_PublishesAndDecodesRisk() public {
        oracle.publishRisk(address(1), 87);
        uint256 packed = oracle.getRisk(address(1));
        (uint48 score, uint48 updatedAt) = oracle.decode(packed);
        assertEq(score, 87);
        assertEq(updatedAt, block.timestamp);
    }

    function test_RevertWhen_NotPublisher() public {
        vm.prank(address(2));
        vm.expectRevert(HookGuardOracle.NotAuthorized.selector);
        oracle.publishRisk(address(1), 1);
    }

    function test_RevertWhen_InvalidInputs() public {
        vm.expectRevert(HookGuardOracle.InvalidScore.selector);
        oracle.publishRisk(address(1), 101);
        vm.expectRevert(HookGuardOracle.EmptyHook.selector);
        oracle.publishRisk(address(0), 1);
    }

    function testFuzz_PublishValidScores(uint48 score, address hook, uint256 time) public {
        vm.assume(hook != address(0));
        vm.assume(score <= 100);
        vm.warp(time % 2 ** 48);
        oracle.publishRisk(hook, score);
        (uint48 storedScore, uint48 storedAt) = oracle.decode(oracle.getRisk(hook));
        assertEq(storedScore, score);
        assertEq(storedAt, uint48(block.timestamp));
    }
}
