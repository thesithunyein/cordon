import { Interface } from 'ethers'
console.log('borrow(address,uint256,uint256,uint256,address):', new Interface(['function borrow(address,uint256,uint256,uint256,address)']).getSighash('borrow'))
