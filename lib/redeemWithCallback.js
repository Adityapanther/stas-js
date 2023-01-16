const bsv = require('bsv')
const {
  handleChange,
  getVersion,
  completeSTASUnlockingScript
} = require('./stas')

const { bitcoinToSatoshis } = require('./utils')

/*
 Redeem converts the STAS tokens back to BSV satoshis and sends them to the redeem address that was
 specified when the token was created.
 The tokenOwnerPrivateKey must own the existing STAS UTXO (stasUtxo),
 contractPublicKey is the redeem address
 paymentPrivateKey owns the paymentUtxo and will be the owner of any change from the fee.
*/
function redeemWithCallback (tokenOwnerPublicKey, contractPublicKey, stasUtxo, paymentUtxo, paymentPublicKey, ownerSignatureCallback, paymentSignatureCallback) {
  if (tokenOwnerPublicKey === null) {
    throw new Error('Token owner public key is null')
  }

  if (contractPublicKey === null) {
    throw new Error('contract public key is null')
  }

  if (stasUtxo === null) {
    throw new Error('stasUtxo is null')
  }

  if (paymentUtxo !== null && paymentPublicKey === null) {
    throw new Error('Payment UTXO provided but payment key is null')
  }
  if (paymentUtxo === null && paymentPublicKey !== null) {
    throw new Error('Payment key provided but payment UTXO is null')
  }

  const isZeroFee = (paymentUtxo === null)

  const tx = new bsv.Transaction()

  tx.from(stasUtxo)

  if (!isZeroFee) {
    tx.from(paymentUtxo)
  }

  // check that contractPublic key is a redeem address - backwards compatible
  let publicKeyhash
  if (bsv.Script.fromHex(`OP_DUP OP_HASH160 ${contractPublicKey} OP_EQUALVERIFY OP_CHECKSIG`).isPublicKeyHashOut()) {
    publicKeyhash = contractPublicKey
    
  } else {
    publicKeyHash = bsv.crypto.Hash.sha256ripemd160(contractPublicKey.toBuffer()).toString('hex')
  }

  // Now pay the satoshis that are tied up in the STAS token to the redeemPublicKey...
  const redeemScript = bsv.Script.fromASM(`OP_DUP OP_HASH160 ${publicKeyHash} OP_EQUALVERIFY OP_CHECKSIG`)
  tx.addOutput(new bsv.Transaction.Output({
    script: redeemScript,
    satoshis: bitcoinToSatoshis(stasUtxo.amount)
  }))

  if (!isZeroFee) {
    handleChange(tx, paymentPublicKey)
  }

  // Sign the inputs...
  tx.inputs.forEach((input, i) => {
    if (i === 0) {
      // STAS input
      const signature = ownerSignatureCallback(tx, i, input.output._script, input.output._satoshisBN)
      const segments = []
      segments.push(
        {
          satoshis: bitcoinToSatoshis(stasUtxo.amount),
          publicKey: publicKeyHash
        })
      segments.push(null)

      if (tx.outputs.length > 1 && !isZeroFee) {
        segments.push({
          satoshis: tx.outputs[1].satoshis,
          publicKey: bsv.crypto.Hash.sha256ripemd160(paymentPublicKey.toBuffer()).toString('hex')
        })
      }

      completeSTASUnlockingScript(
        tx,
        segments,
        signature.toTxFormat().toString('hex'),
        tokenOwnerPublicKey.toString('hex'),
        getVersion(stasUtxo.scriptPubKey),
        isZeroFee
      )
    } else if (!isZeroFee) {
      const signature = paymentSignatureCallback(tx, i, input.output._script, input.output._satoshisBN)
      const unlockingScript = bsv.Script.fromASM(signature.toTxFormat().toString('hex') + ' ' + paymentPublicKey.toString('hex'))
      input.setScript(unlockingScript)
    }
  })

  return tx.serialize(true)
}

module.exports = redeemWithCallback
