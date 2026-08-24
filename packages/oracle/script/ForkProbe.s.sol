// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

interface IManager {
    function unlock(bytes calldata data) external payable returns (bytes memory);
}

contract ForkProbe is Test, IManager {
    address constant SELF = address(uint160(uint256(keccak256("hookguard.forkprobe"))));
    address constant MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    string public lastResult = "not-run";
    bytes public lastReturn;

    function run() external {
        (bool ok, bytes memory result) = SELF.call(abi.encodeCall(this.unlock, ("")));
        lastResult = ok ? "success" : "failed";
        lastReturn = result;
    }

    function unlock(bytes calldata data) external payable returns (bytes memory) {
        return IManager(MANAGER).unlock(data);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == MANAGER, "callback: unauthorized");
        return abi.encode(data.length, block.number);
    }
}
