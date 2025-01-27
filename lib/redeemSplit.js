const bsv = require('@vaionex/bsv')
const { sighash } = require('./stas')

const redeemSplitWithCallback = require('./redeemSplitWithCallback')

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
function redeemSplit (tokenOwnerPrivateKey, contractPublicKey, stasUtxo, splitDestinations, paymentUtxo, paymentPrivateKey) {
  if (contractPublicKey === null) {
    throw new Error('contract public key is null')
  }
  if (tokenOwnerPrivateKey === null) {
    throw new Error('Token owner private key is null')
  }
  const ownerSignatureCallback = (tx, i, script, satoshis) => {
    return bsv.Transaction.sighash.sign(tx, tokenOwnerPrivateKey, sighash, i, script, satoshis)
  }
  const paymentSignatureCallback = (tx, i, script, satoshis) => {
    return bsv.Transaction.sighash.sign(tx, paymentPrivateKey, sighash, i, script, satoshis)
  }

  return redeemSplitWithCallback(tokenOwnerPrivateKey.publicKey, contractPublicKey, stasUtxo, splitDestinations, paymentUtxo, paymentPrivateKey ? paymentPrivateKey.publicKey : null, ownerSignatureCallback, paymentSignatureCallback)
}

module.exports = redeemSplit
