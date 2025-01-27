const expect = require('chai').expect
const utils = require('../utils/test_utils')
const bsv = require('@vaionex/bsv')
const axios = require('axios')
require('dotenv').config()

const {
  contract,
  issue
} = require('../../index')

const {
  getTransaction,
  getFundsFromFaucet,
  broadcast
} = require('../../index').utils

const issuerPrivateKey = bsv.PrivateKey()
const fundingPrivateKey = bsv.PrivateKey()
let contractTx
let contractTxid

const incorrectPrivateKey = bsv.PrivateKey()
const bobPrivateKey = bsv.PrivateKey()
const alicePrivateKey = bsv.PrivateKey()
const symbol = 'TAALT'
const supply = 10000

const aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()
const bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()

// We create contract with incorrect public key hash
beforeEach(async () => {
  const contractUtxos = await getFundsFromFaucet(issuerPrivateKey.toAddress(process.env.NETWORK).toString())
  const fundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())
  const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(incorrectPrivateKey.publicKey.toBuffer()).toString('hex')
  const schema = utils.schema(publicKeyHash, symbol, supply)

  const contractHex = contract(
    issuerPrivateKey,
    contractUtxos,
    fundingUtxos,
    fundingPrivateKey,
    schema,
    supply
  )
  contractTxid = await broadcast(contractHex)
  contractTx = await getTransaction(contractTxid)
})

it('Attempt to issue invalid token', async () => {
  const issueHex = issue(
    issuerPrivateKey,
    issueInfo(),
    contractUtxo(),
    paymentUtxo(),
    fundingPrivateKey,
    true,
    symbol,
    2
  )
  const issueTxid = await broadcast(issueHex)
  const tokenId = await getToken(issueTxid)
  const url = 'https://taalnet.whatsonchain.com/v1/bsv/taalnet/token/' + tokenId + '/TAALT'
  try {
    await axios({
      method: 'get',
      url,
      auth: {
        username: process.env.API_USERNAME,
        password: process.env.API_PASSWORD
      }
    })
  } catch (e) {
    expect(e).to.be.instanceOf(Error)
    expect(e.message).to.eql('Request failed with status code 404')
  }
})

async function getToken (txid) {
  const url = 'https://taalnet.whatsonchain.com/v1/bsv/taalnet/tx/hash/' + txid
  const response = await axios({
    method: 'get',
    url,
    auth: {
      username: process.env.API_USERNAME,
      password: process.env.API_PASSWORD
    }
  })

  const temp = response.data.vout[0].scriptPubKey.asm
  const split = temp.split('OP_RETURN')[1]
  const tokenId = split.split(' ')[1]
  console.log('tokenId', tokenId)
  return tokenId
}

function contractUtxo () {
  return {
    txid: contractTxid,
    vout: 0,
    scriptPubKey: contractTx.vout[0].scriptPubKey.hex,
    amount: contractTx.vout[0].value
  }
}

function paymentUtxo () {
  return {
    txid: contractTxid,
    vout: 1,
    scriptPubKey: contractTx.vout[1].scriptPubKey.hex,
    amount: contractTx.vout[1].value
  }
}

function issueInfo () {
  return [
    {
      addr: aliceAddr,
      satoshis: 7000,
      data: 'one'
    },
    {
      addr: bobAddr,
      satoshis: 3000,
      data: 'two'
    }
  ]
}
