const bsv = require('@vaionex/bsv')
const {
  updateStasScript,
  handleChange,
  getVersion,
  completeSTASUnlockingScript,
  validateSplitDestinations,
  getPublicKeyHash
} = require('./stas')

const { bitcoinToSatoshis, addressToPubkeyhash } = require('./utils')

/*
 RedeemSplit splits the STAS input and sends tokens to the recipients specified in the
 splitDestinations parameter, the rest of the STAS tokens are converted back to BSV
 satoshis and sent to the redeem address that was specified when the token was created.

 The tokenOwnerPrivateKey must own the existing STAS UTXO (stasUtxo),
 splitDestinations is an array containg the address and amount of the recipients of the tokens, the rest or the input will
 be redeemed
 contractPublicKey is the redeem address
 paymentPrivateKey owns the paymentUtxo and will be the owner of any change from the fee.
*/
function redeemSplitWithCallback (tokenOwnerPublicKey, contractPublicKey, stasUtxo, splitDestinations, paymentUtxo, paymentPublicKey, ownerSignatureCallback, paymentSignatureCallback) {
  if (contractPublicKey === null) {
    throw new Error('contract public key is null')
  }
  if (tokenOwnerPublicKey === null) {
    throw new Error('issuer public key is null')
  }
  if (splitDestinations === null || splitDestinations.length === 0) {
    throw new Error('split destinations array is null or empty')
  }

  if (paymentUtxo !== null && paymentPublicKey === null) {
    throw new Error('Payment UTXO provided but payment public key is null')
  }

  validateSplitDestinations(splitDestinations)

  const isZeroFee = (paymentUtxo === null)

  const tx = new bsv.Transaction()

  tx.from(stasUtxo)
  if (!isZeroFee) {
    tx.from(paymentUtxo)
  }

  // The first output is the change
  const version = getVersion(stasUtxo.scriptPubKey)
  const totalOutSats = splitDestinations.reduce((a, b) => a + b.amount, 0)

  const redeemSats = bitcoinToSatoshis(stasUtxo.amount) - totalOutSats

  if (redeemSats <= 0) {
    throw new Error('Not enough input Satoshis to cover output. Trying to redeem ' + redeemSats + ' sats')
  }

  const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(contractPublicKey.toBuffer()).toString('hex')

  const redeemScript = bsv.Script.fromASM(`OP_DUP OP_HASH160 ${publicKeyHash} OP_EQUALVERIFY OP_CHECKSIG`)

  tx.addOutput(new bsv.Transaction.Output({
    script: redeemScript,
    satoshis: redeemSats
  }))

  const segments = []
  segments.push({
    satoshis: redeemSats,
    publicKey: bsv.crypto.Hash.sha256ripemd160(contractPublicKey.toBuffer()).toString('hex')
  })

  splitDestinations.forEach(sd => {
    const destinationPublicKeyHash = addressToPubkeyhash(sd.address)
    // The other outputs are the STAS tokens remaining
    const pkh = addressToPubkeyhash(sd.address)
    const sats = sd.amount
    const stasScript = updateStasScript(destinationPublicKeyHash, stasUtxo.scriptPubKey)

    const issuerPublicKeyHash = getPublicKeyHash(stasScript)
    if (issuerPublicKeyHash === destinationPublicKeyHash) {
      throw new Error('Token UTXO cannot be sent to issuer address')
    }

    tx.addOutput(new bsv.Transaction.Output({
      script: stasScript,
      satoshis: sats
    }))

    segments.push({
      satoshis: sats,
      publicKey: pkh
    })
  })
  if (!isZeroFee) {
    handleChange(tx, paymentPublicKey)
    segments.push({
      satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
      publicKey: bsv.crypto.Hash.sha256ripemd160(paymentPublicKey.toBuffer()).toString('hex')
    })
  }
  // Sign the inputs...
  tx.inputs.forEach((input, i) => {
    if (i === 0) {
      // STAS input
      const signature = ownerSignatureCallback(tx, i, input.output._script, input.output._satoshisBN)

      completeSTASUnlockingScript(
        tx,
        segments,
        signature.toTxFormat().toString('hex'),
        tokenOwnerPublicKey.toString('hex'),
        version,
        isZeroFee
      )
    } else if (!isZeroFee) {
      const signature = paymentSignatureCallback(tx, i, input.output._script, input.output._satoshisBN)
      const unlockingScript = bsv.Script.fromASM(signature.toTxFormat().toString('hex') + ' ' + paymentPublicKey.toString('hex'))
      input.setScript(unlockingScript)
    }
  })

  return tx
}

module.exports = redeemSplitWithCallback
