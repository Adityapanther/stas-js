const bsv = require('bsv')

const {
  contract,
  issue,
  transfer,
  split,
  merge,
  redeem
} = require('./index')

const {
  getTransaction,
  getFundsFromFaucet,
  broadcast
} = require('./index').utils

;(async () => {
  const issuerPrivateKey = bsv.PrivateKey()

  const alicePrivateKey = bsv.PrivateKey()
  const aliceAddr = alicePrivateKey.toAddress().toString()

  const bobPrivateKey = bsv.PrivateKey()
  const bobAddr = bobPrivateKey.toAddress().toString()

  const utxos = await getFundsFromFaucet(issuerPrivateKey.toAddress('testnet').toString())

  const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(issuerPrivateKey.publicKey.toBuffer()).toString('hex')

  const schema = {
    schemaId: 'Schema STAS Coupon',
    tokenName: 'TAALT',
    tokenId: publicKeyHash,
    tokenDescription: 'Example token on private Taalnet',
    issuerName: 'Taal Technologies SEZC',
    issuerCountry: 'CYM',
    issuerLegalForm: 'Limited Liability Public Company',
    issuerEmail: 'info@taal.com',
    issuerWebsite: 'https://taal.com',
    terms: '© 2020 TAAL TECHNOLOGIES SEZC\nALL RIGHTS RESERVED. ANY USE OF THIS SOFTWARE IS SUBJECT TO TERMS AND CONDITIONS OF LICENSE. USE OF THIS SOFTWARE WITHOUT LICENSE CONSTITUTES INFRINGEMENT OF INTELLECTUAL PROPERTY. FOR LICENSE DETAILS OF THE SOFTWARE, PLEASE REFER TO: www.taal.com/stas-token-license-agreement',
    governingLaw: 'Cayman Islands Law',
    icon: 'https://www.taal.com/wp-content/themes/taal_v2/img/favicon/favicon-96x96.png',
    tickerSymbol: 'TAALT'
  }

  const contractHex = contract(
    issuerPrivateKey,
    utxos,
    schema,
    10000
  )
  const contractTxid = await broadcast(contractHex)
  console.log(`Contract TX:     ${contractTxid}`)
  const contractTx = await getTransaction(contractTxid)

  const destinationAddresses = [aliceAddr, bobAddr]

  const issueHex = issue(
    issuerPrivateKey,
    destinationAddresses,
    {
      txid: contractTxid,
      vout: 0,
      scriptPubKey: contractTx.vout[0].scriptPubKey.hex,
      amount: contractTx.vout[0].value
    },
    [{
      txid: contractTxid,
      vout: 1,
      scriptPubKey: contractTx.vout[1].scriptPubKey.hex,
      amount: contractTx.vout[1].value
    }],
    2 // STAS version
  )
  const issueTxid = await broadcast(issueHex)
  console.log(`Issue TX:        ${issueTxid}`)
  const issueTx = await getTransaction(issueTxid)

  const issueOutFundingVout = issueTx.vout.length - 1

  const transferHex = transfer(
    bobPrivateKey,
    issuerPrivateKey.publicKey,
    {
      txid: issueTxid,
      vout: 1,
      scriptPubKey: issueTx.vout[1].scriptPubKey.hex,
      amount: issueTx.vout[1].value
    },
    aliceAddr,
    [{
      txid: issueTxid,
      vout: issueOutFundingVout,
      scriptPubKey: issueTx.vout[issueOutFundingVout].scriptPubKey.hex,
      amount: issueTx.vout[issueOutFundingVout].value
    }],
    issuerPrivateKey
  )
  const transferTxid = await broadcast(transferHex)
  console.log(`Transfer TX:     ${transferTxid}`)
  const transferTx = await getTransaction(transferTxid)

  // Split tokens into 2 - both payable to Bob...
  const bobAmount1 = transferTx.vout[0].value / 2
  const bobAmount2 = transferTx.vout[0].value - bobAmount1

  const splitHex = split(
    alicePrivateKey,
    issuerPrivateKey.publicKey,
    {
      txid: transferTxid,
      vout: 0,
      scriptPubKey: transferTx.vout[0].scriptPubKey.hex,
      amount: transferTx.vout[0].value
    },
    bobAddr,
    bobAmount1,
    bobAddr,
    bobAmount2,
    [{
      txid: transferTxid,
      vout: 1,
      scriptPubKey: transferTx.vout[1].scriptPubKey.hex,
      amount: transferTx.vout[1].value
    }],
    issuerPrivateKey
  )
  const splitTxid = await broadcast(splitHex)
  console.log(`Split TX:        ${splitTxid}`)
  const splitTx = await getTransaction(splitTxid)

  // Now let's merge the last split back together
  const splitTxObj = new bsv.Transaction(splitHex)

  const mergeHex = merge(
    bobPrivateKey,
    issuerPrivateKey.publicKey,
    [{
      tx: splitTxObj,
      vout: 0
    },
    {
      tx: splitTxObj,
      vout: 1
    }],
    aliceAddr,
    {
      txid: splitTxid,
      vout: 2,
      scriptPubKey: splitTx.vout[2].scriptPubKey.hex,
      amount: splitTx.vout[2].value
    },
    issuerPrivateKey
  )

  const mergeTxid = await broadcast(mergeHex)
  console.log(`Merge TX:        ${mergeTxid}`)
  const mergeTx = await getTransaction(mergeTxid)

  // Alice wants to redeem the money from bob...
  const redeemHex = redeem(
    alicePrivateKey,
    issuerPrivateKey.publicKey,
    {
      txid: mergeTxid,
      vout: 0,
      scriptPubKey: mergeTx.vout[0].scriptPubKey.hex,
      amount: mergeTx.vout[0].value
    },
    [{
      txid: mergeTxid,
      vout: 1,
      scriptPubKey: mergeTx.vout[1].scriptPubKey.hex,
      amount: mergeTx.vout[1].value
    }],
    issuerPrivateKey
  )
  const redeemTxid = await broadcast(redeemHex)
  console.log(`Redeem TX:       ${redeemTxid}`)
  // const redeem1Tx = await getTransaction(redeem1Txid)
})()
