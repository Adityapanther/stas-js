const bsv = require('bsv')

const { reverseEndian, numberToLESM } = require('./utils')
const { isStasScript, P2PKH_UNLOCKING_SCRIPT_BYTES } = require('./stas')
const preimageFn = require('./preimage')
const { Varint } = bsv.encoding
const p2pkhRegexStr = '^76a914[0-9a-fA-F]{40}88ac$'
const p2pkhRegex = new RegExp(p2pkhRegexStr)
const sighash = bsv.crypto.Signature.SIGHASH_ALL | bsv.crypto.Signature.SIGHASH_FORKID

/*
The maker provides, or publishes publically to anyone interested,
a partial transaction including his/her input-output pair, with a signature (related to the ownership relay)
in input’s unlocking script signed with ‘SINGLE | ANYONECANPAY’ flags
makerInputUtxo: the utxo the maker is offering to swap
wantedInfo: the script and amount the maker wants for the mmakerInputUtxo.
*/
function createSwapOffer (makerPrivateKey, makerInputUtxo, wantedInfo) {
  console.log('creating swap offer')
  const makerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(makerPrivateKey.publicKey.toBuffer()).toString('hex')
  console.log('makerPublicKeyHash', makerPublicKeyHash)

  const wantedScriptAsm = bsv.Script.fromHex(wantedInfo.scriptHex).toString()

  const wantedSlice1 = wantedScriptAsm.slice(0, 23)
  const wantedSlice2 = wantedScriptAsm.slice(63)
  const makerWantedScriptAsm = wantedSlice1.concat(makerPublicKeyHash).concat(wantedSlice2)
  const makerWantedScript = bsv.Script.fromString(makerWantedScriptAsm).toHex()
  const makerWantedLockingScript = bsv.Script.fromHex(makerWantedScript)

  // const inputIndex = 0
  const flags = bsv.Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID | bsv.Script.Interpreter.SCRIPT_ENABLE_MAGNETIC_OPCODES | bsv.Script.Interpreter.SCRIPT_ENABLE_MONOLITH_OPCODES
  const sighashSingleAnyoneCanPay = bsv.crypto.Signature.SIGHASH_SINGLE | bsv.crypto.Signature.SIGHASH_ANYONECANPAY | bsv.crypto.Signature.SIGHASH_FORKID

  // the makers offered input
  const tx = new bsv.Transaction().from(makerInputUtxo)

  // the makers wanted output
  tx.addOutput(new bsv.Transaction.Output({
    script: makerWantedLockingScript,
    satoshis: wantedInfo.satoshis
  }))

  const preimageBuf = preimageFn(tx, sighashSingleAnyoneCanPay, 0, makerInputUtxo.script, new bsv.crypto.BN(makerInputUtxo.satoshis))
  const preimage = preimageBuf.buf.toString('hex')
  const sigSmart = bsv.Transaction.sighash.sign(tx, makerPrivateKey, sighashSingleAnyoneCanPay, 0, makerInputUtxo.script, new bsv.crypto.BN(makerInputUtxo.satoshis), flags)
  const sigSmartHex = sigSmart.toTxFormat().toString('hex')

  const unlockScript =
  bsv.Script.fromASM(preimage + ' ' + sigSmartHex + ' ' + makerPrivateKey.publicKey.toString('hex'))

  tx.inputs[0].setScript(unlockScript)

  return tx.serialize(true)
}

/*

    You can swap two tokens, a token for satoshis or satoshis for a token.
    How does it work?
    There are 2 players:
    1. The maker initiates the swap
    2. The taker accepts the swap

    For the token-token swap there are 3 steps.
    1. The maker creates an unsigned tx containing the output he wants and the input he's offering.
        He publishes this somewhere.
    2. The taker adds an input which matches the makers output, and an output that matches the makers input.
        He also adds the funding tx.
        He returns this tx to the maker.
    3. The maker signs the tx and submits it to the blockchain

    At a lower level the taker signs for each of the rest of the transaction inputs (both funding and
    spending ones of standard P2PKH type) with ‘ALL’ flag, and completes the 3 missing linking fields
    in the preimage pushed into unlocking script of maker’s input with exactly the same values as in
    the preimage of his spending input, then completes the unlocking script parameters of unlocking
    script of maker’s input either needed to be parsed and used for swapped forward-persistence
    enforcement or simply part of concatenation for verification of others,
*/

/*
    offerTxHex: the offer tx created in createSwapOffer()
    -
    makerStasInputTxHex: the whole tx hex containing the output the maker is offering
    makerStasVout: the output index of the output the maker is offering
    -
    takerStasTxHex: the whole tx hex containing the output the taker is offering
    takerStasVout: the output index of the output the taker is offering
    -
    makerInputSatoshis: the amount the maker offers. Should equal...
    takerOutputSatoshis: the amount the taker wants
    makerOutputSatoshis: the amount the maker wants. Should equal...
    takerInputSatoshis: the amount the taker offers
 */
function acceptSwapOffer (offerTxHex, makerInputSatoshis, makerOutputSatoshis, makerStasInputTxHex, makerStasVout,
  takerPrivateKey, takerStasInputTxHex, takerStasVout, takerInputSatoshis, takerOutputSatoshis, makerPublicKeyHash, paymentUtxo, paymentPrivateKey) {
  console.log('accepting swap offer')
  console.log('makerInputSatoshis: ', makerInputSatoshis)
  console.log('takerOutputSatoshis: ', takerOutputSatoshis)
  console.log('makerOutputSatoshis: ', makerOutputSatoshis)
  console.log('takerInputSatoshis: ', takerInputSatoshis)

  const takerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(takerPrivateKey.publicKey.toBuffer()).toString('hex')
  const paymentPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(paymentPrivateKey.publicKey.toBuffer()).toString('hex')
  console.log('makerPublicKeyHash', makerPublicKeyHash)
  console.log('takerPublicKeyHash', takerPublicKeyHash)
  console.log('paymentPublicKeyHash', paymentPublicKeyHash)

  const makerStasInputTx = JSON.parse(JSON.stringify(bsv.Transaction(makerStasInputTxHex)))
  const makerStasInputScript = bsv.Script.fromHex(makerStasInputTx.outputs[makerStasVout].script)
  const makerStasInputScriptASM = makerStasInputScript.toString()

  const takerStasTx = bsv.Transaction(takerStasInputTxHex)
  const takerOutputScript = takerStasTx.outputs[takerStasVout].script

  const takerStasTokenTxid = bsv.Transaction(takerStasTx).hash

  const makerSlice1 = makerStasInputScriptASM.slice(0, 23)
  const makerSlice2 = makerStasInputScriptASM.slice(63)
  const takerStasTokenrequestAsm = makerSlice1.concat(takerPublicKeyHash).concat(makerSlice2)
  const takerStasTokenrequest = bsv.Script.fromString(takerStasTokenrequestAsm).toHex()

  const flags = bsv.Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID | bsv.Script.Interpreter.SCRIPT_ENABLE_MAGNETIC_OPCODES | bsv.Script.Interpreter.SCRIPT_ENABLE_MONOLITH_OPCODES

  const lockingScriptSplit = bsv.Script.fromHex(takerStasTokenrequest)

  // this is the makers offer tx
  const tx = new bsv.Transaction(offerTxHex)

  // add taker input
  tx.addInput(new bsv.Transaction.Input({
    prevTxId: takerStasTokenTxid,
    outputIndex: takerStasVout,
    script: takerOutputScript
  }), takerOutputScript, takerInputSatoshis)

  // add taker output
  tx.addOutput(new bsv.Transaction.Output({
    script: lockingScriptSplit,
    satoshis: takerOutputSatoshis
  }))

  // add funding input
  tx.addInput(new bsv.Transaction.Input({
    prevTxId: paymentUtxo.txid,
    outputIndex: paymentUtxo.vout,
    script: bsv.Script.fromHex(paymentUtxo.scriptPubKey)
  }), paymentUtxo.scriptPubKey, paymentUtxo.amount)

  // add change
  const extraBytesForPieces = makerStasInputTxHex.length + takerStasInputTxHex.length
  handleChangeForSwap(tx, null, extraBytesForPieces.publicKey)

  const reversedFundingTXID = reverseEndian(paymentUtxo.txid)
  console.log('unlockScript1: takerStasVout', takerStasVout)
  // taker completes the 3 missing linking fields in the preimage pushed into unlocking script of maker’s input
  // with exactly the same values as in the preimage of his spending input
  const unlockScript1 = bsv.Script.fromASM(
    numberToLESM(tx.outputs[0].satoshis) + ' ' + makerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[1].satoshis) + ' ' + takerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[2].satoshis) + ' ' + paymentPublicKeyHash +
    ' ' + `OP_${paymentUtxo.vout}` + ' ' + reversedFundingTXID +
    ' ' + `OP_${takerStasVout}` +
    ' ' + takerStasInputTxHex + ' ' + 'OP_1')
  unlockScript1.add(tx.inputs[0].script)

  const publicKeyTaker = takerPrivateKey.publicKey

  const preimageTakerBuf = preimageFn(tx, sighash, 1, takerOutputScript, new bsv.crypto.BN(takerInputSatoshis))
  const preimageTaker = preimageTakerBuf.buf.toString('hex')

  const takerSignature = bsv.Transaction.sighash.sign(tx, takerPrivateKey, sighash, 1, takerOutputScript, new bsv.crypto.BN(takerInputSatoshis), flags)
  const takerSignatureASM = takerSignature.toTxFormat().toString('hex')

  const unlockScript2 = bsv.Script.fromASM(
    numberToLESM(tx.outputs[0].satoshis) + ' ' + makerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[1].satoshis) + ' ' + takerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[2].satoshis) + ' ' + paymentPublicKeyHash +
    ' ' + `OP_${paymentUtxo.vout}` + ' ' + reversedFundingTXID +
    ' ' + `OP_${makerStasVout}` + // an index of output of that tx, which is attempted to be spent by an input of current spending tx
    ' ' + makerStasInputTxHex +
    ' ' + 'OP_1' + // type of TX: basic, swap or merging
    ' ' + preimageTaker +
    ' ' + takerSignatureASM + ' ' + publicKeyTaker.toString('hex'))

  const paymentSignature = bsv.Transaction.sighash.sign(tx, paymentPrivateKey, sighash, 2, paymentUtxo.scriptPubKey, new bsv.crypto.BN(paymentUtxo.amount), flags)
  const paymentSignatureASM = paymentSignature.toTxFormat().toString('hex')

  const paymentUnlockScript = bsv.Script.fromASM(paymentSignatureASM + ' ' + paymentPrivateKey.publicKey.toString('hex'))

  tx.inputs[0].setScript(unlockScript1)
  tx.inputs[1].setScript(unlockScript2)
  tx.inputs[2].setScript(paymentUnlockScript)

  return tx.serialize(true)
}

/*
The maker provides, or publishes publically to anyone interested,
an unsigned partial transaction including his/her input-output pair
*/
function createUnsignedSwapOffer (makerPrivateKey, makerInputUTXO, wantedInfo) {
  if (wantedInfo.type !== undefined && wantedInfo.type !== 'native') {
    throw new Error('wantedInfo.type must be undefined or "native"')
  }
  console.log('creating unsigned swap offer')
  //   console.log('wantedInfo.scriptHex', wantedInfo.scriptHex)
  //   console.log('makerInputUTXO.satoshis', makerInputUTXO.satoshis)
  console.log('wantedInfo.satoshis', wantedInfo.satoshis)

  const makerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(makerPrivateKey.publicKey.toBuffer()).toString('hex')
  console.log('makerPublicKeyHash', makerPublicKeyHash)
  const wantedType = (wantedInfo.type !== undefined && wantedInfo.type === 'native') ? 'native' : 'token'

  // the makers offered input
  const tx = new bsv.Transaction().from(makerInputUTXO)

  let makerWantedLockingScript
  if (wantedType === 'token') {
    const wantedScriptAsm = bsv.Script.fromHex(wantedInfo.scriptHex).toString()
    const wantedSlice1 = wantedScriptAsm.slice(0, 23)
    const wantedSlice2 = wantedScriptAsm.slice(63)
    const makerWantedScriptAsm = wantedSlice1.concat(makerPublicKeyHash).concat(wantedSlice2)
    const makerWantedScript = bsv.Script.fromString(makerWantedScriptAsm).toHex()
    makerWantedLockingScript = bsv.Script.fromHex(makerWantedScript)
  } else {
    makerWantedLockingScript = bsv.Script.fromASM(`OP_DUP OP_HASH160 ${makerPublicKeyHash} OP_EQUALVERIFY OP_CHECKSIG`)
  }
  tx.addOutput(new bsv.Transaction.Output({
    script: makerWantedLockingScript,
    satoshis: wantedInfo.satoshis
  }))

  return tx.serialize(true)
}

function acceptUnsignedSwapOffer (offerTxHex, makerInputSatoshis, makerOutputSatoshis, makerStasInputTxHex, makerStasVout,
  takerPrivateKey, takerStasTxHex, takerStasVout, takerInputSatoshis, takerOutputSatoshis, makerPublicKeyHash, paymentUtxo, paymentPrivateKey) {
  console.log('accepting unsigned swap offer')
  console.log('makerInputSatoshis: ', makerInputSatoshis)
  console.log('takerOutputSatoshis: ', takerOutputSatoshis)
  console.log('makerOutputSatoshis: ', makerOutputSatoshis)
  console.log('takerInputSatoshis: ', takerInputSatoshis)

  const takerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(takerPrivateKey.publicKey.toBuffer()).toString('hex')

  const paymentPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(paymentPrivateKey.publicKey.toBuffer()).toString('hex')

  const makerStasInputTx = JSON.parse(JSON.stringify(bsv.Transaction(makerStasInputTxHex)))
  const makerStasInputScript = bsv.Script.fromHex(makerStasInputTx.outputs[makerStasVout].script)
  const makerStasInputScriptASM = makerStasInputScript.toString()

  const takerStasTx = bsv.Transaction(takerStasTxHex)
  const takerOutputScript = takerStasTx.outputs[takerStasVout].script

  const takerStasTokenTxid = bsv.Transaction(takerStasTx).hash

  const isMakerInputStasScript = isStasScript(makerStasInputScript.toHex())
  const isTakerOutputStasScript = isStasScript(takerOutputScript.toHex())
  //   const isTakerInputStasScript = isStasScript(takerOutputScript.toHex())

  console.log('isMakerInputStasScript:', isMakerInputStasScript)
  //   console.log('isTakerInputStasScript:', isTakerInputStasScript)
  console.log('isTakerOutputStasScript:', isTakerOutputStasScript)

  // if tx.outputs[0] is a p2pkh then we need to add an appropriate input
  let takerStasTokenrequest
  if (isTakerOutputStasScript) {
    const makerSlice1 = makerStasInputScriptASM.slice(0, 23)
    const makerSlice2 = makerStasInputScriptASM.slice(63)
    const takerStasTokenrequestAsm = makerSlice1.concat(takerPublicKeyHash).concat(makerSlice2)
    takerStasTokenrequest = bsv.Script.fromString(takerStasTokenrequestAsm).toHex()
  } else if (isP2PKHScript(takerOutputScript.toHex())) {
    const makerSlice1 = makerStasInputTx.outputs[makerStasVout].script.slice(0, 6)
    const makerSlice2 = makerStasInputTx.outputs[makerStasVout].script.slice(46)
    takerStasTokenrequest = makerSlice1.concat(takerPublicKeyHash).concat(makerSlice2)
  }

  const flags = bsv.Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID | bsv.Script.Interpreter.SCRIPT_ENABLE_MAGNETIC_OPCODES | bsv.Script.Interpreter.SCRIPT_ENABLE_MONOLITH_OPCODES

  const lockingScriptSplit = bsv.Script.fromHex(takerStasTokenrequest)

  // this is the makers tx
  const tx = new bsv.Transaction(offerTxHex)

  const takerInput = new bsv.Transaction.Input({
    prevTxId: takerStasTokenTxid,
    outputIndex: takerStasVout,
    script: takerOutputScript
  })

  tx.addInput(takerInput, takerOutputScript, takerInputSatoshis)

  // add taker output - wrong
  tx.addOutput(new bsv.Transaction.Output({
    script: lockingScriptSplit,
    satoshis: takerOutputSatoshis
  }))

  // add funding
  tx.addInput(new bsv.Transaction.Input({
    prevTxId: paymentUtxo.txid,
    outputIndex: paymentUtxo.vout,
    script: bsv.Script.fromHex(paymentUtxo.scriptPubKey)
  }), paymentUtxo.scriptPubKey, paymentUtxo.amount)

  // add change
  const extraBytesForPieces = makerStasInputTxHex.length + takerStasTxHex.length
  handleChangeForSwap(tx, extraBytesForPieces, paymentPrivateKey.publicKey)

  const reversedFundingTXID = reverseEndian(paymentUtxo.txid)

  const publicKeyTaker = takerPrivateKey.publicKey

  const preimageTakerBuf = preimageFn(tx, sighash, 1, takerOutputScript, new bsv.crypto.BN(takerInputSatoshis))
  const preimageTaker = preimageTakerBuf.buf.toString('hex')

  const takerSignature = bsv.Transaction.sighash.sign(tx, takerPrivateKey, sighash, 1, takerOutputScript, new bsv.crypto.BN(takerInputSatoshis), flags)
  const takerSignatureASM = takerSignature.toTxFormat().toString('hex')
  let takerUnlockScript

  if (isTakerOutputStasScript) {
    console.log('creating stas takerUnlockScript')
    takerUnlockScript = bsv.Script.fromASM(
      numberToLESM(tx.outputs[0].satoshis) + ' ' + makerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[1].satoshis) + ' ' + takerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[2].satoshis) + ' ' + paymentPublicKeyHash +
    ' ' + `OP_${paymentUtxo.vout}` + ' ' + reversedFundingTXID +
    ' ' + `OP_${makerStasVout}` + // an index of output of that tx, which is attempted to be spent by an input of current spending tx
    ' ' + makerStasInputTxHex +
    ' ' + 'OP_1' + // type of TX: basic, swap or merging
    ' ' + preimageTaker +
    ' ' + takerSignatureASM + ' ' + publicKeyTaker.toString('hex'))
  } else if (isP2PKHScript(takerOutputScript.toHex())) {
    console.log('maker script is p2pkh')
    const takerP2pkhSignature = bsv.Transaction.sighash.sign(tx, takerPrivateKey, sighash, 1, makerStasInputScript, new bsv.crypto.BN(makerOutputSatoshis), flags)
    const paymentSignatureASM = takerP2pkhSignature.toTxFormat().toString('hex')

    takerUnlockScript = bsv.Script.fromASM(paymentSignatureASM + ' ' + takerPrivateKey.publicKey.toString('hex'))
  }

  const paymentSignature = bsv.Transaction.sighash.sign(tx, paymentPrivateKey, sighash, 2, paymentUtxo.scriptPubKey, new bsv.crypto.BN(paymentUtxo.amount), flags)
  const paymentSignatureASM = paymentSignature.toTxFormat().toString('hex')

  const paymentUnlockScript = bsv.Script.fromASM(paymentSignatureASM + ' ' + paymentPrivateKey.publicKey.toString('hex'))

  //   tx.inputs[0].setScript(unlockScript1)
  tx.inputs[1].setScript(takerUnlockScript)
  tx.inputs[2].setScript(paymentUnlockScript)

  return tx.serialize(true)
}

// here the taker is supplying a p2pkh utxo
function acceptUnsignedNativeSwapOffer (offerTxHex, takerInputInfo, makerInputSatoshis, makerOutputSatoshis, makerStasInputTxHex, makerStasVout,
  takerPrivateKey, takerStasTxHex, takerStasVout, takerOutputSatoshis, makerPublicKeyHash, paymentUtxo, paymentPrivateKey) {
  //            acceptUnsignedSwapOffer (offerTxHex, makerInputSatoshis, makerOutputSatoshis, makerStasInputTxHex, makerStasVout,
  // takerPrivateKey, takerStasTxHex, takerStasVout, takerInputSatoshis, takerOutputSatoshis, makerPublicKeyHash, paymentUtxo, paymentPrivateKey) {
  console.log('accepting unsigned swap offer')
  console.log('makerInputSatoshis: ', makerInputSatoshis)
  console.log('takerOutputSatoshis: ', takerOutputSatoshis)
  console.log('makerOutputSatoshis: ', makerOutputSatoshis)
  //   console.log('paymentUtxo: ', paymentUtxo)

  const takerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(takerPrivateKey.publicKey.toBuffer()).toString('hex')

  const makerStasInputTx = JSON.parse(JSON.stringify(bsv.Transaction(makerStasInputTxHex)))
  const makerStasInputScript = bsv.Script.fromHex(makerStasInputTx.outputs[makerStasVout].script)
  const makerStasInputScriptASM = makerStasInputScript.toString()

  const takerStasTx = bsv.Transaction(takerStasTxHex)
  const takerOutputScript = takerStasTx.outputs[takerStasVout].script

  //   const inputType = (takerInputInfo.type !== undefined && takerInputInfo.type === 'native') ? 'native' : 'token'

  //   const isMakerInputStasScript = isStasScript(makerStasInputScript.toHex())
  const isTakerOutputStasScript = isStasScript(takerOutputScript.toHex())

  // if tx.outputs[0] is a p2pkh then we need to add an appropriate input
  let takerStasTokenrequest
  if (isTakerOutputStasScript) {
    const makerSlice1 = makerStasInputScriptASM.slice(0, 23)
    const makerSlice2 = makerStasInputScriptASM.slice(63)
    const takerStasTokenrequestAsm = makerSlice1.concat(takerPublicKeyHash).concat(makerSlice2)
    takerStasTokenrequest = bsv.Script.fromString(takerStasTokenrequestAsm).toHex()
  } else if (isP2PKHScript(takerOutputScript.toHex())) {
    const makerSlice1 = makerStasInputTx.outputs[makerStasVout].script.slice(0, 6)
    const makerSlice2 = makerStasInputTx.outputs[makerStasVout].script.slice(46)
    takerStasTokenrequest = makerSlice1.concat(takerPublicKeyHash).concat(makerSlice2)
  }

  const flags = bsv.Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID | bsv.Script.Interpreter.SCRIPT_ENABLE_MAGNETIC_OPCODES | bsv.Script.Interpreter.SCRIPT_ENABLE_MONOLITH_OPCODES

  const lockingScriptSplit = bsv.Script.fromHex(takerStasTokenrequest)

  // this is the makers tx
  const tx = new bsv.Transaction(offerTxHex)

  // add taker input
  tx.from(takerInputInfo.utxo)

  // add taker output - wrong
  tx.addOutput(new bsv.Transaction.Output({
    script: lockingScriptSplit,
    satoshis: takerOutputSatoshis
  }))

  // add funding
  tx.addInput(new bsv.Transaction.Input({
    prevTxId: paymentUtxo.txid,
    outputIndex: paymentUtxo.vout,
    script: bsv.Script.fromHex(paymentUtxo.scriptPubKey)
  }), paymentUtxo.scriptPubKey, paymentUtxo.amount)

  // add change
  const extraBytesForPieces = makerStasInputTxHex.length + takerStasTxHex.length
  handleChangeForSwap(tx, extraBytesForPieces, paymentPrivateKey.publicKey)
  const takerSignature = bsv.Transaction.sighash.sign(tx, takerPrivateKey, sighash, 1, takerInputInfo.utxo.scriptPubKey, new bsv.crypto.BN(Math.floor(takerInputInfo.utxo.amount * 1E8)), flags)
  const takerSignatureASM = takerSignature.toTxFormat().toString('hex')
  const takerUnlockScript = bsv.Script.fromASM(takerSignatureASM + ' ' + takerPrivateKey.publicKey.toString('hex'))

  const paymentSignature = bsv.Transaction.sighash.sign(tx, paymentPrivateKey, sighash, 2, paymentUtxo.scriptPubKey, new bsv.crypto.BN(paymentUtxo.amount), flags)
  const paymentSignatureASM = paymentSignature.toTxFormat().toString('hex')
  const paymentUnlockScript = bsv.Script.fromASM(paymentSignatureASM + ' ' + paymentPrivateKey.publicKey.toString('hex'))

  tx.inputs[1].setScript(takerUnlockScript)
  tx.inputs[2].setScript(paymentUnlockScript)

  return tx.serialize(true)
}

function makerSignSwapOffer (offerTxHex, makerInputTx, takerInputTx, outpointIndex, makerPrivateKey, takerPublicKeyHash, paymentPublicKeyHash, paymentUtxo) {
  const flags = bsv.Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID | bsv.Script.Interpreter.SCRIPT_ENABLE_MAGNETIC_OPCODES | bsv.Script.Interpreter.SCRIPT_ENABLE_MONOLITH_OPCODES

  const makerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(makerPrivateKey.publicKey.toBuffer()).toString('hex')

  const makerStasTx = bsv.Transaction(makerInputTx)
  const makerOutputScript = makerStasTx.outputs[outpointIndex].script
  const tx = bsv.Transaction(offerTxHex)
  console.log('tx.outputs[0].satoshis (maker)', tx.outputs[0].satoshis)
  console.log('tx.outputs[1].satoshis (taker)', tx.outputs[1].satoshis)
  console.log('tx.outputs[2].satoshis (change)', tx.outputs[2].satoshis)

  const isMakerOutputStasScript = isStasScript(makerOutputScript.toHex())
  //   const isTakerOutputStasScript = isStasScript(takerOutputScript.toHex())

  //   console.log('isMakerOutputStasScript:', isMakerOutputStasScript)
  //   console.log('makerInputTx[outpointIndex].script:', makerStasTx.outputs[outpointIndex].script.toHex())

  const preimageMakerBuf = preimageFn(tx, sighash, 0, makerOutputScript, new bsv.crypto.BN(tx.outputs[1].satoshis))
  const preimageMaker = preimageMakerBuf.buf.toString('hex')
  const makerSignature = bsv.Transaction.sighash.sign(tx, makerPrivateKey, sighash, 0, makerOutputScript, new bsv.crypto.BN(tx.outputs[1].satoshis))
  const makerSignatureASM = makerSignature.toTxFormat().toString('hex')

  const reversedFundingTXID = reverseEndian(paymentUtxo.txid)

  let makerUnlockScript
  if (isMakerOutputStasScript) {
    makerUnlockScript = bsv.Script.fromASM(
      numberToLESM(tx.outputs[0].satoshis) + ' ' + makerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[1].satoshis) + ' ' + takerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[2].satoshis) + ' ' + paymentPublicKeyHash +
    ' ' + `OP_${paymentUtxo.vout}` + ' ' + reversedFundingTXID +
    ' ' + `OP_${outpointIndex}` +
    ' ' + takerInputTx + ' ' + 'OP_1' + ' ' + // type of TX: basic, swap or merging
       preimageMaker + ' ' + makerSignatureASM + ' ' + makerPrivateKey.publicKey.toString('hex'))
  } else {
    const makerSignature = bsv.Transaction.sighash.sign(tx, makerPrivateKey, sighash, 0, makerStasTx.outputs[outpointIndex].script, new bsv.crypto.BN(tx.outputs[1].satoshis), flags)
    const makerSignatureASM = makerSignature.toTxFormat().toString('hex')
    makerUnlockScript = bsv.Script.fromASM(makerSignatureASM + ' ' + makerPrivateKey.publicKey.toString('hex'))
  }
  tx.inputs[0].setScript(makerUnlockScript)

  return tx.serialize(true)
}
/*
a
b
c
d
e
f
g
h
*/
function allInOneSwap (makerPrivateKey, makerInputUtxo, wantedInfo, makerStasInputTxHex, makerStasVout,
  takerPrivateKey, takerStasInputTxHex, takerStasVout, takerInputSatoshis, takerOutputSatoshis, paymentUtxo, paymentPrivateKey) {
  console.log('allInOneSwap')
  console.log('makerInputSatoshis: ', makerInputUtxo.satoshis)
  console.log('takerOutputSatoshis: ', takerOutputSatoshis)
  console.log('makerOutputSatoshis: ', wantedInfo.satoshis)
  console.log('takerInputSatoshis: ', takerInputSatoshis)
  if (makerPrivateKey === null) {
    throw new Error('Maker private key is null')
  }
  if (takerPrivateKey === null) {
    throw new Error('Taker private key is null')
  }
  if (makerInputUtxo === null) {
    throw new Error('Maker input UTXO is null')
  } else if (makerInputUtxo.satoshis < 0 || makerInputUtxo.script === '' || makerInputUtxo.outputIndex < 0 || makerInputUtxo.txId === '') {
    throw new Error('Invalid maker input UTXO')
  }
  if (typeof makerInputUtxo.script !== 'object') {
    throw new Error('makerInputUtxo.script must be an object')
  }
  if (makerInputUtxo.satoshis !== takerOutputSatoshis) {
    throw new Error('makerInputUtxo.satoshis should equal takerOutputSatoshis')
  }
  if (wantedInfo.satoshis !== takerInputSatoshis) {
    throw new Error('wantedInfo.satoshis should equal takerInputSatoshis')
  }

  if (makerStasInputTxHex === null || makerStasInputTxHex.length < 100) {
    throw new Error('Invalid makerStasInputTxHex')
  }
  if (takerStasInputTxHex === null || takerStasInputTxHex.length < 100) {
    throw new Error('Invalid takerStasInputTxHex')
  }
  if (paymentUtxo.txid === null || typeof paymentUtxo.txid.length < 1) {
    throw new Error('paymentUtxo.txid must be a string')
  }
  if (paymentUtxo.scriptPubKey === null || typeof paymentUtxo.scriptPubKey !== 'string') {
    throw new Error('paymentUtxo.scriptPubKey must be a string')
  }

  const makerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(makerPrivateKey.publicKey.toBuffer()).toString('hex')
  console.log('makerPublicKeyHash', makerPublicKeyHash)
  const takerPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(takerPrivateKey.publicKey.toBuffer()).toString('hex')
  console.log('takerPublicKeyHash', takerPublicKeyHash)
  const paymentPublicKeyHash = bsv.crypto.Hash.sha256ripemd160(paymentPrivateKey.publicKey.toBuffer()).toString('hex')
  console.log('paymentPublicKeyHash', paymentPublicKeyHash)

  const wantedScriptAsm = bsv.Script.fromHex(wantedInfo.scriptHex).toString()

  const wantedSlice1 = wantedScriptAsm.slice(0, 23)
  const wantedSlice2 = wantedScriptAsm.slice(63)
  const makerWantedScriptAsm = wantedSlice1.concat(makerPublicKeyHash).concat(wantedSlice2)
  const makerWantedScript = bsv.Script.fromString(makerWantedScriptAsm).toHex()
  const makerWantedLockingScript = bsv.Script.fromHex(makerWantedScript)

  // the makers offered input
  const tx = new bsv.Transaction().from(makerInputUtxo)

  // the makers wanted output
  tx.addOutput(new bsv.Transaction.Output({
    script: makerWantedLockingScript,
    satoshis: wantedInfo.satoshis
  }))

  const makerStasInputTx = JSON.parse(JSON.stringify(bsv.Transaction(makerStasInputTxHex)))
  const makerStasInputScript = bsv.Script.fromHex(makerStasInputTx.outputs[makerStasVout].script)
  const makerStasInputScriptASM = makerStasInputScript.toString()

  const takerStasInputTx = bsv.Transaction(takerStasInputTxHex)
  const takerStasInputScript = takerStasInputTx.outputs[takerStasVout].script

  const takerStasTokenTxid = bsv.Transaction(takerStasInputTx).hash
  console.log('takerStasTokenTxid:', takerStasTokenTxid)

  const makerSlice1 = makerStasInputScriptASM.slice(0, 23)
  const makerSlice2 = makerStasInputScriptASM.slice(63)
  const takerStasTokenrequestAsm = makerSlice1.concat(takerPublicKeyHash).concat(makerSlice2)
  const takerStasTokenrequest = bsv.Script.fromString(takerStasTokenrequestAsm)// .toHex()

  tx.addInput(new bsv.Transaction.Input({
    prevTxId: takerStasTokenTxid,
    outputIndex: takerStasVout,
    script: takerStasInputScript
  }), takerStasInputScript, takerInputSatoshis)

  // add taker output - wrong
  tx.addOutput(new bsv.Transaction.Output({
    script: takerStasTokenrequest,
    satoshis: takerOutputSatoshis
  }))

  // add funding
  tx.addInput(new bsv.Transaction.Input({
    prevTxId: paymentUtxo.txid,
    outputIndex: paymentUtxo.vout,
    script: bsv.Script.fromHex(paymentUtxo.scriptPubKey)
  }), paymentUtxo.scriptPubKey, paymentUtxo.amount)

  // add change
  const extraBytesForPieces = makerStasInputTxHex.length + takerStasInputTxHex.length
  handleChangeForSwap(tx, extraBytesForPieces, paymentPrivateKey.publicKey)

  const preimageBuf = preimageFn(tx, sighash, 0, makerInputUtxo.script, new bsv.crypto.BN(makerInputUtxo.satoshis))
  const preimage = preimageBuf.buf.toString('hex')
  const sigSmart = bsv.Transaction.sighash.sign(tx, makerPrivateKey, sighash, 0, makerInputUtxo.script, new bsv.crypto.BN(makerInputUtxo.satoshis))
  const sigSmartHex = sigSmart.toTxFormat().toString('hex')

  const preimageTakerBuf = preimageFn(tx, sighash, 1, takerStasInputScript, new bsv.crypto.BN(takerInputSatoshis))
  const preimageTaker = preimageTakerBuf.buf.toString('hex')
  const takerSignature = bsv.Transaction.sighash.sign(tx, takerPrivateKey, sighash, 1, takerStasInputScript, new bsv.crypto.BN(takerInputSatoshis))
  const takerSignatureHex = takerSignature.toTxFormat().toString('hex')

  const paymentSignature = bsv.Transaction.sighash.sign(tx, paymentPrivateKey, sighash, 2, bsv.Script.fromHex(paymentUtxo.scriptPubKey), new bsv.crypto.BN(paymentUtxo.amount))
  const paymentSignatureHex = paymentSignature.toTxFormat().toString('hex')

  const reversedFundingTXID = reverseEndian(paymentUtxo.txid)
  console.log('makerUnlockScript: makerStasVout', makerStasVout)
  console.log('takerUnlockScript: takerStasVout', takerStasVout)
  console.log('takerUnlockScript: paymentUtxo.vout', paymentUtxo.vout)
  console.log('tx.outputs[0].satoshis: ', tx.outputs[0].satoshis)
  console.log('tx.outputs[1].satoshis: ', tx.outputs[1].satoshis)
  console.log('tx.outputs[2].satoshis: ', tx.outputs[2].satoshis)

  // taker completes the 3 missing linking fields in the preimage pushed into unlocking script of maker’s input
  // with exactly the same values as in the preimage of his spending input
  const makerUnlockScript = bsv.Script.fromASM(
    numberToLESM(tx.outputs[0].satoshis) + ' ' + makerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[1].satoshis) + ' ' + takerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[2].satoshis) + ' ' + paymentPublicKeyHash +
    ' ' + `OP_${paymentUtxo.vout}` + ' ' + reversedFundingTXID +
    ' ' + `OP_${takerStasVout}` +
    ' ' + takerStasInputTxHex + ' ' + 'OP_1' + ' ' + // type of TX: basic, swap or merging
       preimage + ' ' + sigSmartHex + ' ' + makerPrivateKey.publicKey.toString('hex'))

  //   const publicKeyMaker = makerPrivateKey.publicKey
  const publicKeyTaker = takerPrivateKey.publicKey
  const publicKeyPayment = paymentPrivateKey.publicKey

  //   console.log('takerSignatureHex ', takerSignatureHex)
  // type of TX: basic, swap or merging
  const takerUnlockScript = bsv.Script.fromASM(
    numberToLESM(tx.outputs[0].satoshis) + ' ' + makerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[1].satoshis) + ' ' + takerPublicKeyHash +
    ' ' + numberToLESM(tx.outputs[2].satoshis) + ' ' + paymentPublicKeyHash +
    ' ' + `OP_${paymentUtxo.vout}` + ' ' + reversedFundingTXID +
    ' ' + `OP_${makerStasVout}` + // an index of output of that tx, which is attempted to be spent by an input of current spending tx
    ' ' + makerStasInputTxHex + ' ' + 'OP_1' + // type of TX: basic, swap or merging
    ' ' + preimageTaker + ' ' + takerSignatureHex + ' ' + publicKeyTaker.toString('hex'))

  const paymentUnlockScript = bsv.Script.fromASM(paymentSignatureHex + ' ' + publicKeyPayment.toString('hex'))

  tx.inputs[0].setScript(makerUnlockScript)
  tx.inputs[1].setScript(takerUnlockScript)
  tx.inputs[2].setScript(paymentUnlockScript)

  return tx.serialize(true)
}

function isP2PKHScript (script) {
  if (p2pkhRegex.test(script)) {
    return true
  }
  return false
}

function handleChangeForSwap (tx, extraDataBytes, publicKey) {
  // In this implementation, we will always add a change output...

  // Create a change output. The satoshi amount will be updated after we calculate the fees.
  // ---------------------------------------------------------------------------------------
  const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(publicKey.toBuffer()).toString('hex')

  const changeScript = bsv.Script.fromASM(`OP_DUP OP_HASH160 ${publicKeyHash} OP_EQUALVERIFY OP_CHECKSIG`)
  tx.addOutput(new bsv.Transaction.Output({
    script: changeScript,
    satoshis: 0
  }))

  // Now we need to calculate the preimage of the transaction.  This will become part of the unlocking script
  // and therefore increases the size and cost of the overall TX.
  //   console.log('handleChangeForSwap: tx.inputs[0]:', tx.inputs[0])
  // we won't have the output script of tx.inputs[0].output if the maker hasn't signed yet.
  // workaround is to estimate it.
  let preimageLen = 0
  let imageBufLength = 0
  //   console.log('x.inputs[0].output', tx.inputs[0].output)
  if (tx.inputs[0].output === undefined) {
    // console.log('here: tx.outputs[0].script', tx.outputs[0].script.toHex())
    if (isStasScript(tx.outputs[0].script.toHex())) {
      console.log('setting preimagelen')
      preimageLen = 3206 // estimate the preimage size
    }
  } else {
    const image = preimageFn(tx, sighash, 0, tx.inputs[0].output.script, tx.inputs[0].output.satoshisBN)
    preimageLen = new Varint().fromNumber(image.buf.length).toBuffer().length
    imageBufLength = image.buf.length
  }
  console.log('preimageLen:', preimageLen)
  console.log('imageBufLength:', imageBufLength)

  //
  // Calculate the fee required
  // ---------------------------------------------------------------------------------------
  // The actual unlocking script for STAS will be:
  // STAS amount                                       Up to 9 bytes
  // pubkeyhash                                        21 bytes
  // OP_FALSE OP_FALSE OP_FALSE OP_FALSE (4 bytes)     4
  // Output funding index                              Up to 9 bytes
  // TXID                                              33 bytes
  // Output index                                      Up to 9 bytes
  // Pieces (Partly P2PSH)                             (passed in to function)
  // Size of the number of pieces                      1 byte
  // OP_PUSH(<len(preimage)                             preimageLen  // There are 2 preimages, 1 for input 0 and 1 for input 1
  // Preimage (len(preimage)                           len(preimage)
  // OP_PUSH_72                                           1 byte
  // <signature> DER-encoded signature (70-72 bytes) -   72 bytes
  // OP_PUSH_33                                           1 byte
  // <public key> - compressed SEC-encoded public key  - 33 bytes

  // Calculate the fees required...
  let txSizeInBytes = tx.toBuffer().length + 9 + 21 + 4 + 9 + 33 + 9 + extraDataBytes + ((preimageLen + imageBufLength) * 2) + 1 + 72 + 1 + 33
  txSizeInBytes += ((tx.inputs.length - 1) * P2PKH_UNLOCKING_SCRIPT_BYTES)

  let satoshis = 0
  tx.inputs.forEach((input, i) => {
    if (i > 1) { // Skip the 2 STAS inputs...
      satoshis += input.output.satoshis
    }
  })

  const fee = Math.ceil(txSizeInBytes * process.env.SATS / process.env.PERBYTE)
  console.log('handleChangeForSwap: txSizeInBytes:', txSizeInBytes)
  console.log('                   : fee:', fee)
  tx.outputs[tx.outputs.length - 1].satoshis = satoshis - fee
}

module.exports = {
  createSwapOffer,
  acceptSwapOffer,
  allInOneSwap,
  createUnsignedSwapOffer,
  acceptUnsignedSwapOffer,
  acceptUnsignedNativeSwapOffer,
  makerSignSwapOffer
}