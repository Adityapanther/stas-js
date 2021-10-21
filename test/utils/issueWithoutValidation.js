const bsv = require('bsv')
require('dotenv').config()
const {
  P2PKH_UNLOCKING_SCRIPT_BYTES,
  getStasScript,
  sighash
} = require('../../lib/stas')
const { addressToPubkeyhash, SATS_PER_BITCOIN } = require('../../lib/utils')

// the minimum length of a bitcoin address
const ADDRESS_MIN_LENGTH = 26
// the maximum length of a bitcoin address
const ADDRESS_MAX_LENGTH = 35

// issue issues one or more token outputs from the contract
// privateKey that can spend the contract, issueInfo contains the addresses, satoshis and extra data to issue to
// contractUtxo is the contract output, paymentUtxo pay sthe fees for the issue transaction
// version can be 2 only
// Validation checks removed to test STAS directly
function issueWithoutValiation (privateKey, issueInfo, contractUtxo, paymentUtxo, paymentPrivateKey, isSplittable, version) {
  if (!isIssueInfoValid(issueInfo)) {
    throw new Error('issueInfo is invalid')
  }
  if (!isUtxoValid(contractUtxo)) {
    throw new Error('contractUtxo is invalid')
  }

  // if the payment UTXO is null then we treat this as a zero fee transaction
  const isZeroFee = (paymentUtxo === null)

  const totalOutSats = issueInfo.reduce((a, b) => a + b.satoshis, 0)

  // create a new transaction
  const tx = new bsv.Transaction()

  // add the STAS input
  tx.from(contractUtxo)

  // Variable to count the input satoshis
  let satoshis = 0

  if (!isZeroFee) {
    // add the payment utxos to the transaction
    tx.from(paymentUtxo)
    satoshis += Math.round(paymentUtxo.amount * SATS_PER_BITCOIN)
  }

  issueInfo.forEach(is => {
    const pubKeyHash = addressToPubkeyhash(is.addr)
    let data
    if (is.data) {
      data = Buffer.from(is.data).toString('hex')
    }
    // Add the issuing output
    const stasScript = getStasScript(pubKeyHash, privateKey.publicKey, version, data, isSplittable)

    tx.addOutput(new bsv.Transaction.Output({
      script: stasScript,
      satoshis: is.satoshis
    }))
  })

  if (!isZeroFee) {
    const paymentPubKeyHash = bsv.crypto.Hash.sha256ripemd160(paymentPrivateKey.publicKey.toBuffer()).toString('hex')

    const changeScript = bsv.Script.fromASM(`OP_DUP OP_HASH160 ${paymentPubKeyHash} OP_EQUALVERIFY OP_CHECKSIG`)
    // Calculate the change amount
    const txSize = (tx.serialize(true).length / 2) + 1 + 8 + changeScript.toBuffer().length + (tx.inputs.length * P2PKH_UNLOCKING_SCRIPT_BYTES)
    const fee = Math.ceil(txSize * process.env.SATS / process.env.PERBYTE)

    tx.addOutput(new bsv.Transaction.Output({
      script: changeScript,
      satoshis: Math.floor(satoshis - fee)
    }))
  }

  // bsv.js does not like signing non-standard inputs.  Therefore, we do this ourselves.
  tx.inputs.forEach((input, i) => {
    let privKey
    if (i === 0) {
      // first input is contract
      privKey = privateKey
    } else {
      // remaining inputs are payment utxos
      privKey = paymentPrivateKey
    }
    const signature = bsv.Transaction.sighash.sign(tx, privKey, sighash, i, input.output._script, input.output._satoshisBN)
    const unlockingScript = bsv.Script.fromASM(signature.toTxFormat().toString('hex') + ' ' + privKey.publicKey.toString('hex'))
    input.setScript(unlockingScript)
  })

  return tx.serialize(true)
}

// make sure issueInfo array contains the required objects
function isIssueInfoValid (issueInfo) {
  if (issueInfo === null || !Array.isArray(issueInfo) || issueInfo.length < 1) {
    return false
  }
  issueInfo.forEach(info => {
    if (info.addr.length < ADDRESS_MIN_LENGTH || info.addr.length > ADDRESS_MAX_LENGTH) {
      console.log(`info.addr.length<20: ${info.addr.length}`)
      return false
    }
    if (info.satoshis < 1) {
      console.log(`info.satoshis < 1: ${info.satoshis}`)
      return false
    }
  })
  return true
}

// make sure issueInfo array contains the required objects
function isUtxoValid (utxo) {
  if ((!utxo) || (!utxo.constructor === Object)) {
    return false
  }
  if (!Object.prototype.hasOwnProperty.call(utxo, 'txid') ||
  !Object.prototype.hasOwnProperty.call(utxo, 'amount') ||
  !Object.prototype.hasOwnProperty.call(utxo, 'scriptPubKey') ||
  !Object.prototype.hasOwnProperty.call(utxo, 'vout')) {
    return false
  }
  return true
}

module.exports = {
  issueWithoutValiation
}