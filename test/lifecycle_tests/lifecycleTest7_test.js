const expect = require('chai').expect
const utils = require('../utils/test_utils')
const bsv = require('@vaionex/bsv')
require('dotenv').config()

const {
  contract,
  issue,
  transfer,
  split,
  merge,
  mergeSplit,
  redeem
} = require('../../index')

const {
  bitcoinToSatoshis,
  getTransaction,
  getFundsFromFaucet,
  broadcast
} = require('../../index').utils

describe('regression, testnet', () => {
  it('Full Life Cycle Test 7 - Issuance with 32kb of data', async () => {
    const issuerPrivateKey = bsv.PrivateKey()
    const fundingPrivateKey = bsv.PrivateKey()

    const alicePrivateKey = bsv.PrivateKey()
    const aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()

    const bobPrivateKey = bsv.PrivateKey()
    const bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()

    const contractUtxos = await getFundsFromFaucet(issuerPrivateKey.toAddress(process.env.NETWORK).toString())
    const fundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())

    const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(issuerPrivateKey.publicKey.toBuffer()).toString('hex')
    const supply = 10000
    const symbol = 'TAALT'
    const schema = utils.schema(publicKeyHash, symbol, supply)

    console.log('Alice  ' + aliceAddr)
    console.log('Bob  ' + bobAddr)

    const wait = 5000 // set wait before token balance check

    // change goes back to the fundingPrivateKey
    const contractHex = contract(
      issuerPrivateKey,
      contractUtxos,
      fundingUtxos,
      fundingPrivateKey,
      schema,
      supply
    )
    const contractTxid = await broadcast(contractHex)
    console.log(`Contract TX:     ${contractTxid}`)
    const contractTx = await getTransaction(contractTxid)

    const issueInfo = [
      {
        addr: aliceAddr,
        satoshis: 7000,
        data: utils.addData(32)
      },
      {
        addr: bobAddr,
        satoshis: 3000,
        data: 'two'
      }
    ]

    const issueHex = issue(
      issuerPrivateKey,
      issueInfo,
      utils.getUtxo(contractTxid, contractTx, 0),
      utils.getUtxo(contractTxid, contractTx, 1),
      fundingPrivateKey,
      true,
      symbol,
      2
    )
    const issueTxid = await broadcast(issueHex)
    const issueTx = await getTransaction(issueTxid)
    const tokenId = await utils.getToken(issueTxid)
    console.log(`Token ID:        ${tokenId}`)
    const response = await utils.getTokenResponse(tokenId)
    expect(response.symbol).to.equal(symbol)
    expect(await utils.getVoutAmount(issueTxid, 0)).to.equal(0.00007)
    expect(await utils.getVoutAmount(issueTxid, 1)).to.equal(0.00003)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(7000)
    expect(await utils.getTokenBalance(bobAddr)).to.equal(3000)

    const issueOutFundingVout = issueTx.vout.length - 1

    const transferHex = transfer(
      alicePrivateKey,
      utils.getUtxo(issueTxid, issueTx, 0),
      bobAddr,
      utils.getUtxo(issueTxid, issueTx, issueOutFundingVout),
      fundingPrivateKey
    )
    const transferTxid = await broadcast(transferHex)
    console.log(`Transfer TX:     ${transferTxid}`)
    const transferTx = await getTransaction(transferTxid)
    await new Promise(resolve => setTimeout(resolve, wait))
    expect(await utils.getVoutAmount(transferTxid, 0)).to.equal(0.00007)
    expect(await utils.getTokenBalance(bobAddr)).to.equal(10000)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(0)

    // Split tokens into 2 - both payable to Bob...
    const bobAmount1 = transferTx.vout[0].value / 2
    const bobAmount2 = transferTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: aliceAddr, amount: bitcoinToSatoshis(bobAmount1) }
    splitDestinations[1] = { address: aliceAddr, amount: bitcoinToSatoshis(bobAmount2) }

    const splitHex = split(
      bobPrivateKey,
      utils.getUtxo(transferTxid, transferTx, 0),
      splitDestinations,
      utils.getUtxo(transferTxid, transferTx, 1),
      fundingPrivateKey
    )
    const splitTxid = await broadcast(splitHex)
    await new Promise(resolve => setTimeout(resolve, wait))
    console.log(`Split TX:        ${splitTxid}`)
    const splitTx = await getTransaction(splitTxid)
    await new Promise(resolve => setTimeout(resolve, wait))
    expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.000035)
    expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.000035)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(7000)
    expect(await utils.getTokenBalance(bobAddr)).to.equal(3000)

    // Now let's merge the last split back together
    const splitTxObj = new bsv.Transaction(splitHex)

    const mergeHex = merge(
      alicePrivateKey,
      utils.getMergeUtxo(splitTxObj),
      bobAddr,
      utils.getUtxo(splitTxid, splitTx, 2),
      fundingPrivateKey
    )

    const mergeTxid = await broadcast(mergeHex)
    await new Promise(resolve => setTimeout(resolve, wait))
    console.log(`Merge TX:        ${mergeTxid}`)
    const mergeTx = await getTransaction(mergeTxid)
    await new Promise(resolve => setTimeout(resolve, wait))
    expect(await utils.getVoutAmount(mergeTxid, 0)).to.equal(0.00007)
    const tokenIdMerge = await utils.getToken(mergeTxid)
    const responseMerge = await utils.getTokenResponse(tokenIdMerge)
    expect(responseMerge.symbol).to.equal(symbol)
    expect(responseMerge.contract_txs).to.contain(contractTxid)
    expect(responseMerge.issuance_txs).to.contain(issueTxid)
    expect(await utils.getTokenBalance(bobAddr)).to.equal(10000)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(0)

    // Split again - both payable to Bob...
    const amount = mergeTx.vout[0].value / 2

    const split2Destinations = []
    split2Destinations[0] = { address: aliceAddr, amount: bitcoinToSatoshis(amount) }
    split2Destinations[1] = { address: aliceAddr, amount: bitcoinToSatoshis(amount) }

    const splitHex2 = split(
      bobPrivateKey,
      utils.getUtxo(mergeTxid, mergeTx, 0),
      split2Destinations,
      utils.getUtxo(mergeTxid, mergeTx, 1),
      fundingPrivateKey
    )
    const splitTxid2 = await broadcast(splitHex2)
    await new Promise(resolve => setTimeout(resolve, wait))
    console.log(`Split TX2:       ${splitTxid2}`)
    const splitTx2 = await getTransaction(splitTxid2)
    await new Promise(resolve => setTimeout(resolve, wait))
    expect(await utils.getVoutAmount(splitTxid2, 0)).to.equal(0.000035)
    expect(await utils.getVoutAmount(splitTxid2, 1)).to.equal(0.000035)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(7000)
    expect(await utils.getTokenBalance(bobAddr)).to.equal(3000)

    // Now mergeSplit
    const splitTxObj2 = new bsv.Transaction(splitHex2)

    const aliceAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[0].value) / 2
    const bobAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[0].value) + bitcoinToSatoshis(splitTx2.vout[1].value) - aliceAmountSatoshis

    const mergeSplitHex = mergeSplit(
      alicePrivateKey,
      utils.getMergeSplitUtxo(splitTxObj2, splitTx2),
      aliceAddr,
      aliceAmountSatoshis,
      bobAddr,
      bobAmountSatoshis,
      utils.getUtxo(splitTxid2, splitTx2, 2),
      fundingPrivateKey
    )

    const mergeSplitTxid = await broadcast(mergeSplitHex)
    await new Promise(resolve => setTimeout(resolve, wait))
    console.log(`MergeSplit TX:   ${mergeSplitTxid}`)
    const mergeSplitTx = await getTransaction(mergeSplitTxid)
    await new Promise(resolve => setTimeout(resolve, wait))
    expect(await utils.getVoutAmount(mergeSplitTxid, 0)).to.equal(0.0000175)
    expect(await utils.getVoutAmount(mergeSplitTxid, 1)).to.equal(0.0000525)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(1750)
    expect(await utils.getTokenBalance(bobAddr)).to.equal(8250)

    // Alice wants to redeem the money from bob...
    const redeemHex = redeem(
      alicePrivateKey,
      issuerPrivateKey.publicKey,
      utils.getUtxo(mergeSplitTxid, mergeSplitTx, 0),
      utils.getUtxo(mergeSplitTxid, mergeSplitTx, 2),
      fundingPrivateKey
    )
    const redeemTxid = await broadcast(redeemHex)
    await new Promise(resolve => setTimeout(resolve, wait))
    console.log(`Redeem TX:       ${redeemTxid}`)
    await new Promise(resolve => setTimeout(resolve, wait))
    expect(await utils.getVoutAmount(redeemTxid, 0)).to.equal(0.0000175)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(0) // 750 of alice tokens were redeemed
    expect(await utils.getTokenBalance(bobAddr)).to.equal(8250)
  })
})
