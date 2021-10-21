const expect = require("chai").expect
const assert = require('chai').assert
const utils = require('./utils/test_utils')
const axios = require('axios')
const bsv = require('bsv')
require('dotenv').config()

const {
    contract,
    issue,
    transfer,
    split
} = require('../index')

const {
    getTransaction,
    getFundsFromFaucet,
    broadcast
} = require('../index').utils

const issuerPrivateKey = bsv.PrivateKey()
const fundingPrivateKey = bsv.PrivateKey()
const bobPrivateKey = bsv.PrivateKey()
const alicePrivateKey = bsv.PrivateKey()
const bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()
const aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()
let issueTxid
let issueTx

beforeEach(async function () {

    await setup() //contract and issue
});


it("Successful Split Into Two Tokens With Fee", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }

    const splitHex = split(
        alicePrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
    const splitTxid = await broadcast(splitHex)
    let noOfTokens = await countNumOfTokens(splitTxid, true)
    expect(splitDestinations).to.have.length(noOfTokens) //ensure that tx output contains 2 values
    expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.000035)
    expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.000035)
    expect(await utils.areFeesProcessed(splitTxid, 2)).to.be.true
})


it("Successful Split Into Four Tokens", async function () {

    const bobAmount = issueTx.vout[0].value / 4
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount }
    splitDestinations[2] = { address: bobAddr, amount: bobAmount }
    splitDestinations[3] = { address: bobAddr, amount: bobAmount }

    const splitHex = split(
        alicePrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
    const splitTxid = await broadcast(splitHex)
    let noOfTokens = await countNumOfTokens(splitTxid, true)
    expect(splitDestinations).to.have.length(noOfTokens) //ensure that tx output contains 4 values
    expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.0000175)
    expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.0000175)
    expect(await utils.getVoutAmount(splitTxid, 2)).to.equal(0.0000175)
    expect(await utils.getVoutAmount(splitTxid, 3)).to.equal(0.0000175)

})

it("Successful Split Into Two Tokens With No Fee", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }

    const splitHex = split(
        alicePrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        null,
        null
    )
    const splitTxid = await broadcast(splitHex)
    let noOfTokens = await countNumOfTokens(splitTxid, false)
    expect(splitDestinations).to.have.length(noOfTokens) //ensure that tx output contains 2 values
    expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.000035)
    expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.000035)
    expect(await utils.areFeesProcessed(splitTxid, 2)).to.be.false
})

//needs fixed
it("Successful Split Into Two Tokens With No Fee Empty Array", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }

    const splitHex = split(
        alicePrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        [],
        null
    )
    const splitTxid = await broadcast(splitHex)
    let noOfTokens = await countNumOfTokens(splitTxid, false)
    expect(splitDestinations).to.have.length(noOfTokens) //ensure that tx output contains 2 values
    expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.000035)
    expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.000035)
    expect(await utils.areFeesProcessed(splitTxid, 2)).to.be.false
})

it("Splitting Into Too Many Tokens Throws Error", async function () {

    const bobAmount = issueTx.vout[0].value / 5
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount }
    splitDestinations[2] = { address: bobAddr, amount: bobAmount }
    splitDestinations[3] = { address: bobAddr, amount: bobAmount }
    splitDestinations[4] = { address: bobAddr, amount: bobAmount }
    try {
        const splitHex = split(
            alicePrivateKey,
            issuerPrivateKey.publicKey,
            utils.getUtxo(issueTxid, issueTx, 0),
            splitDestinations,
            utils.getUtxo(issueTxid, issueTx, 2),
            fundingPrivateKey
        )
        assert(false)
    } catch (e) {
        expect(e).to.be.instanceOf(Error)
        expect(e.message).to.eql('Must have less than 5 segments')
    }
})

it("No Split Completes Successfully", async function () {

    const bobAmount = issueTx.vout[0].value
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount }

    const splitHex = split(
        alicePrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
    const splitTxid = await broadcast(splitHex)
    let noOfTokens = await countNumOfTokens(splitTxid, true)
    expect(splitDestinations).to.have.length(noOfTokens) //ensure that tx output contains 1 
})


it("Add Too Much To Split Throws Error", async function () {

    const bobAmount = issueTx.vout[0].value * 2
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount }

    const splitHex = split(
        alicePrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
    try {
        await broadcast(splitHex)
        assert(false)
        return
    } catch (e) {
        expect(e).to.be.instanceOf(Error)
        expect(e.message).to.eql('Request failed with status code 400')
    }
})

//throwing a 'Checksum mismatch' error - if i am reading code correctly it should validate address first 
//and trigger > ADDRESS_MAX_LENGTH  error
it("Address Too Long Throws Error", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    console.log(bobAddr)
    const splitDestinations = []
    splitDestinations[0] = { address: '1LF2wNCBT9dp5jN7fa6xSAaUGjJ5Pyz5VGaUG', amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }
    const incorrectPrivateKey = bsv.PrivateKey()
    try {
    const splitHex = split(
        incorrectPrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
        assert(false)
        return
    } catch (e) {
        expect(e).to.be.instanceOf(Error)
        expect(e.message).to.eql('Invalid Address string provided')
    }
})

it("Address Too Short Throws Error", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    console.log(bobAddr)
    const splitDestinations = []
    splitDestinations[0] = { address: '1LF2wNCBT9dp5jN7fa6xSAaU', amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }
    const incorrectPrivateKey = bsv.PrivateKey()
    try {
    const splitHex = split(
        incorrectPrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
        assert(false)
        return
    } catch (e) {
        expect(e).to.be.instanceOf(Error)
        expect(e.message).to.eql('Invalid Address string provided')
    }
})
it("Incorrect Owner Private Key Throws Error", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }
    const incorrectPrivateKey = bsv.PrivateKey()

    const splitHex = split(
        incorrectPrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
    try {
        await broadcast(splitHex)
        assert(false)
        return
    } catch (e) {
        expect(e).to.be.instanceOf(Error)
        expect(e.message).to.eql('Request failed with status code 400')
    }
})

it("Incorrect Payments Private Key Throws Error", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }
    const incorrectPrivateKey = bsv.PrivateKey()

    const splitHex = split(
        issuerPrivateKey,
        issuerPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        incorrectPrivateKey
    )
    try {
        await broadcast(splitHex)
        assert(false)
        return
    } catch (e) {
        expect(e).to.be.instanceOf(Error)
        expect(e.message).to.eql('Request failed with status code 400')
    }
})

it("Incorrect Contract Public Key Throws Error", async function () {

    const bobAmount1 = issueTx.vout[0].value / 2
    const bobAmount2 = issueTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bobAmount1 }
    splitDestinations[1] = { address: bobAddr, amount: bobAmount2 }
    const incorrectPrivateKey = bsv.PrivateKey()

    const splitHex = split(
        issuerPrivateKey,
        incorrectPrivateKey.publicKey,
        utils.getUtxo(issueTxid, issueTx, 0),
        splitDestinations,
        utils.getUtxo(issueTxid, issueTx, 2),
        fundingPrivateKey
    )
    try {
        await broadcast(splitHex)
        assert(false)
        return
    } catch (e) {
        expect(e).to.be.instanceOf(Error)
        expect(e.message).to.eql('Request failed with status code 400')
    }
})

async function setup() {

    const contractUtxos = await getFundsFromFaucet(issuerPrivateKey.toAddress(process.env.NETWORK).toString())
    const fundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())
    const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(issuerPrivateKey.publicKey.toBuffer()).toString('hex')
    const symbol = 'TAALT'
    const supply = 10000
    const schema = utils.schema(publicKeyHash, symbol, supply)

    const contractHex = contract(
        issuerPrivateKey,
        contractUtxos,
        fundingUtxos,
        fundingPrivateKey,
        schema,
        supply
    )
    const contractTxid = await broadcast(contractHex)
    const contractTx = await getTransaction(contractTxid)

    const issueHex = issue(
        issuerPrivateKey,
        utils.getIssueInfo(aliceAddr, 7000, bobAddr, 3000),
        utils.getUtxo(contractTxid, contractTx, 0),
        utils.getUtxo(contractTxid, contractTx, 1),
        fundingPrivateKey,
        true,
        2
    )
     issueTxid = await broadcast(issueHex)
     issueTx = await getTransaction(issueTxid)
}


async function countNumOfTokens(txid, isThereAFee) {

    const url = 'https://taalnet.whatsonchain.com/v1/bsv/taalnet/tx/hash/' + txid
    const response = await axios({
        method: 'get',
        url,
        auth: {
      username: process.env.API_USERNAME,
      password: process.env.API_PASSWORD
        }
    })

    let count = 0
    for (var i = 0; i < response.data.vout.length; i++) {
        if (response.data.vout[i].value != null) {
            count++
        }
    }
    if (isThereAFee == true) //output decreased by 1 if fees charged
        return count - 1
    else
        return count
}
