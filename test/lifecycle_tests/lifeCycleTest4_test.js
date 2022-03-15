const expect = require('chai').expect
const utils = require('../utils/test_utils')
const bsv = require('bsv')
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
  it(
    'Full Life Cycle Test With Decimals And Extra SatsPerToken',
    async () => {
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
      schema.decimals = 2
      schema.satsPerToken = 5
      const wait = 5000

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

      const issueHex = issue(
        issuerPrivateKey,
        utils.getIssueInfo(aliceAddr, 7000, bobAddr, 3000),
        utils.getUtxo(contractTxid, contractTx, 0),
        utils.getUtxo(contractTxid, contractTx, 1),
        fundingPrivateKey,
        true,
        symbol,
        2
      )
      const issueTxid = await broadcast(issueHex)
      await new Promise(resolve => setTimeout(resolve, wait))
      const issueTx = await getTransaction(issueTxid)
      const tokenId = await utils.getToken(issueTxid)
      console.log(`issueTx :        ${issueTxid}`)
      console.log(`Token ID:        ${tokenId}`)
      const response = await utils.getTokenResponse(tokenId)
      expect(response.symbol).to.equal(symbol)
      expect(await utils.getVoutAmount(issueTxid, 0)).to.equal(0.00007)
      expect(await utils.getVoutAmount(issueTxid, 1)).to.equal(0.00003)
      console.log('Alice Balance ' + (await utils.getTokenBalance(aliceAddr)))
      console.log('Bob Balance ' + (await utils.getTokenBalance(bobAddr)))
      expect(await utils.getTokenBalance(aliceAddr)).to.equal(7000)
      expect(await utils.getTokenBalance(bobAddr)).to.equal(3000)

      const issueOutFundingVout = issueTx.vout.length - 1

      const transferHex = transfer(
        bobPrivateKey,
        utils.getUtxo(issueTxid, issueTx, 1),
        aliceAddr,
        utils.getUtxo(issueTxid, issueTx, issueOutFundingVout),
        fundingPrivateKey
      )
      const transferTxid = await broadcast(transferHex)
      await new Promise(resolve => setTimeout(resolve, wait))
      console.log(`Transfer TX:     ${transferTxid}`)
      const transferTx = await getTransaction(transferTxid)
      expect(await utils.getVoutAmount(transferTxid, 0)).to.equal(0.00003)
      expect(await utils.getTokenBalance(aliceAddr)).to.equal(10000)
      expect(await utils.getTokenBalance(bobAddr)).to.equal(0)
      console.log('Alice Balance ' + (await utils.getTokenBalance(aliceAddr)))
      console.log('Bob Balance ' + (await utils.getTokenBalance(bobAddr)))

      // Split tokens into 2 - both payable to Bob...
      const bobAmount1 = transferTx.vout[0].value / 2
      const bobAmount2 = transferTx.vout[0].value - bobAmount1
      const splitDestinations = []
      splitDestinations[0] = { address: bobAddr, amount: bitcoinToSatoshis(bobAmount1) }
      splitDestinations[1] = { address: bobAddr, amount: bitcoinToSatoshis(bobAmount2) }

      const splitHex = split(
        alicePrivateKey,
        utils.getUtxo(transferTxid, transferTx, 0),
        splitDestinations,
        utils.getUtxo(transferTxid, transferTx, 1),
        fundingPrivateKey
      )
      const splitTxid = await broadcast(splitHex)
      await new Promise(resolve => setTimeout(resolve, wait))
      console.log(`Split TX:        ${splitTxid}`)
      const splitTx = await getTransaction(splitTxid)
      expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.000015)
      expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.000015)
      console.log('Alice Balance ' + (await utils.getTokenBalance(aliceAddr)))
      console.log('Bob Balance ' + (await utils.getTokenBalance(bobAddr)))
      expect(await utils.getTokenBalance(aliceAddr)).to.equal(7000)
      expect(await utils.getTokenBalance(bobAddr)).to.equal(3000)

      // Now let's merge the last split back together
      const splitTxObj = new bsv.Transaction(splitHex)

      const mergeHex = merge(
        bobPrivateKey,
        utils.getMergeUtxo(splitTxObj),
        aliceAddr,
        utils.getUtxo(splitTxid, splitTx, 2),
        fundingPrivateKey
      )

      const mergeTxid = await broadcast(mergeHex)
      await new Promise(resolve => setTimeout(resolve, wait))
      console.log(`Merge TX:        ${mergeTxid}`)
      const mergeTx = await getTransaction(mergeTxid)
      expect(await utils.getVoutAmount(mergeTxid, 0)).to.equal(0.00003)
      const tokenIdMerge = await utils.getToken(issueTxid)
      const responseMerge = await utils.getTokenResponse(tokenIdMerge)
      expect(responseMerge.symbol).to.equal(symbol)
      expect(responseMerge.contract_txs).to.contain(contractTxid)
      expect(responseMerge.issuance_txs).to.contain(issueTxid)
      console.log('Alice Balance ' + (await utils.getTokenBalance(aliceAddr)))
      console.log('Bob Balance ' + (await utils.getTokenBalance(bobAddr)))
      expect(await utils.getTokenBalance(aliceAddr)).to.equal(10000)
      expect(await utils.getTokenBalance(bobAddr)).to.equal(0)

      const amount = mergeTx.vout[0].value / 2

      const split2Destinations = []
      split2Destinations[0] = { address: bobAddr, amount: bitcoinToSatoshis(amount) }
      split2Destinations[1] = { address: bobAddr, amount: bitcoinToSatoshis(amount) }

      const splitHex2 = split(
        alicePrivateKey,
        utils.getUtxo(mergeTxid, mergeTx, 0),
        split2Destinations,
        utils.getUtxo(mergeTxid, mergeTx, 1),
        fundingPrivateKey
      )
      const splitTxid2 = await broadcast(splitHex2)
      await new Promise(resolve => setTimeout(resolve, wait))
      console.log(`Split TX2:       ${splitTxid2}`)
      const splitTx2 = await getTransaction(splitTxid2)
      expect(await utils.getVoutAmount(splitTxid2, 0)).to.equal(0.000015)
      expect(await utils.getVoutAmount(splitTxid2, 1)).to.equal(0.000015)
      console.log('Alice Balance ' + (await utils.getTokenBalance(aliceAddr)))
      console.log('Bob Balance ' + (await utils.getTokenBalance(bobAddr)))
      expect(await utils.getTokenBalance(aliceAddr)).to.equal(7000)
      expect(await utils.getTokenBalance(bobAddr)).to.equal(3000)

      // Now mergeSplit
      const splitTxObj2 = new bsv.Transaction(splitHex2)

      const aliceAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[0].value) / 2
      const bobAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[0].value) + bitcoinToSatoshis(splitTx2.vout[1].value) - aliceAmountSatoshis

      const mergeSplitHex = mergeSplit(
        bobPrivateKey,
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
      expect(await utils.getVoutAmount(mergeSplitTxid, 0)).to.equal(0.0000075)
      expect(await utils.getVoutAmount(mergeSplitTxid, 1)).to.equal(0.0000225)
      console.log('Alice Balance ' + (await utils.getTokenBalance(aliceAddr)))
      console.log('Bob Balance ' + (await utils.getTokenBalance(bobAddr)))
      expect(await utils.getTokenBalance(aliceAddr)).to.equal(7750)
      expect(await utils.getTokenBalance(bobAddr)).to.equal(2250)

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
      expect(await utils.getVoutAmount(redeemTxid, 0)).to.equal(0.0000075)
      expect(await utils.getTokenBalance(aliceAddr)).to.equal(7000)
      expect(await utils.getTokenBalance(bobAddr)).to.equal(2250)
    }
  )
})
