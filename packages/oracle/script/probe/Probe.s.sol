pragma solidity ^0.8.20;
interface IManager { function unlock(bytes calldata data) external payable returns (bytes memory); }
contract Probe {
  address constant MANAGER=0x498581fF718922c3f8e6A244956aF099B2652b2b;
  string public result="not-run"; bytes public returned;
  function run() external {
    (bool ok, bytes memory ret)=address(this).call(abi.encodeCall(this.unlock, ("")));
    result=ok?"success":"failed"; returned=ret;
  }
  function unlock(bytes calldata d) external returns(bytes memory){return IManager(MANAGER).unlock(d);}
  function unlockCallback(bytes calldata d) external view returns(bytes memory){
    require(msg.sender==MANAGER,"bad caller");
    return abi.encode(d.length, block.number, address(0xBeef));
  }
}
