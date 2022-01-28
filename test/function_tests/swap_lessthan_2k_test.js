// const expect = require('chai').expect
// const assert = require('chai').assert
const utils = require('../utils/test_utils')
const bsv = require('bsv')
// const assert = require('assert')
const expect = require('chai').expect

require('dotenv').config()

const {
  //   createSwapOffer,
  //   acceptSwapOffer,
  allInOneSwap,
  createUnsignedSwapOffer,
  acceptUnsignedSwapOffer,
  acceptUnsignedNativeSwapOffer,
  makerSignSwapOffer
} = require('../../index').swap

const {
  getTransaction,
  getRawTransaction,
  getFundsFromFaucet,
  broadcast
} = require('../../index').utils

const {
  contract,
  issue
} = require('../../index')

// const { sighash } = require('../../lib/stas')

let fundingPrivateKey
let bobPrivateKey
let alicePrivateKey
let bobAddr
let aliceAddr
let paymentPublicKeyHash
let tokenAIssueHex
let tokenBIssueHex
let tokenAObj
let tokenBObj
let tokenBIssueTx
let tokenBIssueTxid
let fundingUTXO
let alicePublicKeyHash
let bobPublicKeyHash

beforeEach(async function () {
  await setup()
})

describe('atomic swap failing - when token B sats are set to > 2k the broadcast fails with (Signature must be zero for failed CHECK(MULTI)SIG operation)', function () {
  // swap two STAS tokens
  it('Swap - 3 step token-token swap', async function () {
    const takerStasInputScriptHex = tokenAObj.outputs[0].script.toHex()
    const makerStasInputScript = tokenBObj.outputs[0].script

    const makerInputSatoshis = tokenBObj.outputs[0].satoshis
    const takerOutputSatoshis = makerInputSatoshis
    const makerOutputSatoshis = tokenAObj.outputs[0].satoshis
    const takerInputSatoshis = makerOutputSatoshis
    const makerInputUtxo = {
      txId: tokenBIssueTxid,
      outputIndex: 0,
      script: makerStasInputScript,
      satoshis: makerInputSatoshis
    }

    const wantedInfo = { scriptHex: takerStasInputScriptHex, satoshis: makerOutputSatoshis }

    const unsignedSwapOfferHex = createUnsignedSwapOffer(
      alicePrivateKey,
      makerInputUtxo,
      wantedInfo
    )

    // now bob takes the offer
    const takerSignedSwapHex = acceptUnsignedSwapOffer(unsignedSwapOfferHex, tokenBIssueHex,
      bobPrivateKey, tokenAIssueHex, 0, takerInputSatoshis, takerOutputSatoshis, alicePublicKeyHash,
      fundingUTXO, fundingPrivateKey)

    const fullySignedSwapHex = makerSignSwapOffer(takerSignedSwapHex, tokenBIssueHex, tokenAIssueHex, alicePrivateKey, bobPublicKeyHash, paymentPublicKeyHash, fundingUTXO)
    console.log(fullySignedSwapHex)
    const swapTxid = await broadcast(fullySignedSwapHex)
    expect(await utils.getVoutAmount(swapTxid, 0)).to.equal(0.00006)
    expect(await utils.getVoutAmount(swapTxid, 1)).to.equal(0.00002)
    expect(await utils.getTokenBalance(aliceAddr)).to.equal(6000)
    expect(await utils.getTokenBalance(bobAddr)).to.equal(2000)
  })
})

async function setup () {
  const tokenAIssuerPrivateKey = bsv.PrivateKey()
  const tokenBIssuerPrivateKey = bsv.PrivateKey()
  fundingPrivateKey = bsv.PrivateKey()
  paymentPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(fundingPrivateKey.publicKey.toBuffer()).toString('hex')
  alicePrivateKey = bsv.PrivateKey()
  bobPrivateKey = bsv.PrivateKey()

  bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()
  aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()

  const tokenAContractUtxos = await getFundsFromFaucet(tokenAIssuerPrivateKey.toAddress(process.env.NETWORK).toString())
  const tokenBContractUtxos = await getFundsFromFaucet(tokenBIssuerPrivateKey.toAddress(process.env.NETWORK).toString())
  const tokenAFundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())
  const tokenBFundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())
  const tokenAIssuerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(tokenAIssuerPrivateKey.publicKey.toBuffer()).toString('hex')
  const tokenBIssuerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(tokenBIssuerPrivateKey.publicKey.toBuffer()).toString('hex')
  alicePublicKeyHash = bsv.crypto.Hash.sha256ripemd160(alicePrivateKey.publicKey.toBuffer()).toString('hex')
  bobPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(bobPrivateKey.publicKey.toBuffer()).toString('hex')

  // Token A
  const tokenASymbol = 'TOKENA'
  const tokenASupply = 6000
  const tokenASchema = utils.schema(tokenAIssuerPublicKeyHash, tokenASymbol, tokenASupply)
  const tokenAContractHex = contract(
    tokenAIssuerPrivateKey,
    tokenAContractUtxos,
    tokenAFundingUtxos,
    fundingPrivateKey,
    tokenASchema,
    tokenASupply
  )
  const tokenAContractTxid = await broadcast(tokenAContractHex)
  const tokenAContractTx = await getTransaction(tokenAContractTxid)

  tokenAIssueHex = issue(
    tokenAIssuerPrivateKey,
    [{
      addr: bobAddr,
      satoshis: 6000,
      data: 'one'
    }],
    utils.getUtxo(tokenAContractTxid, tokenAContractTx, 0),
    utils.getUtxo(tokenAContractTxid, tokenAContractTx, 1),
    fundingPrivateKey,
    true,
    tokenASymbol,
    2
  )
  await broadcast(tokenAIssueHex)
  tokenAObj = new bsv.Transaction(tokenAIssueHex)

  // Token B
  const tokenBSymbol = 'TOKENB'
  const tokenBSupply = 2000
  const tokenBSchema = utils.schema(tokenBIssuerPublicKeyHash, tokenBSymbol, tokenBSupply)
  const tokenBContractHex = contract(
    tokenBIssuerPrivateKey,
    tokenBContractUtxos,
    tokenBFundingUtxos,
    fundingPrivateKey,
    tokenBSchema,
    tokenBSupply
  )
  const tokenBContractTxid = await broadcast(tokenBContractHex)
  const tokenBContractTx = await getTransaction(tokenBContractTxid)

  tokenBIssueHex = issue(
    tokenBIssuerPrivateKey,
    [{
      addr: aliceAddr,
      satoshis: 2000,
      data: 'one'
    }],
    utils.getUtxo(tokenBContractTxid, tokenBContractTx, 0),
    utils.getUtxo(tokenBContractTxid, tokenBContractTx, 1),
    fundingPrivateKey,
    true,
    tokenBSymbol,
    2
  )
  tokenBIssueTxid = await broadcast(tokenBIssueHex)
  tokenBIssueTx = await getTransaction(tokenBIssueTxid)
  tokenBObj = new bsv.Transaction(tokenBIssueHex)
  fundingUTXO = {
    txid: tokenBIssueTxid,
    vout: 1,
    scriptPubKey: tokenBIssueTx.vout[1].scriptPubKey.hex,
    amount: Math.floor(tokenBIssueTx.vout[1].value * 1E8)
  }
}