require('dotenv').config()
const axios = require('axios')
const mongoose = require('mongoose')
const ethers = require('ethers')

const rpcapi = process.env.NETWORK_RPC
const chainID = parseInt(process.env.NETWORK_CHAINID)
const ftmScanApiURL = process.env.FTM_SCAN_URL

const provider = new ethers.providers.JsonRpcProvider(rpcapi, chainID)

const NFTITEM = mongoose.model('NFTITEM')
const ERC721CONTRACT = mongoose.model('ERC721CONTRACT')
const Like = mongoose.model('Like')

const contractutils = require('./contract.utils')

const ftmScanApiKey = process.env.FTM_SCAN_API_KEY
const validatorAddress = process.env.VALIDATORADDRESS
const limit = 99999999999999

const toLowerCase = (val) => {
  if (val) return val.toLowerCase()
  else return val
}

const loadedContracts = new Map()

const bannedCollections = new Map()

const isBannedCollection = async (contractAddress) => {
  let isBanned = bannedCollections.get(contractAddress)
  if (isBanned) return true
  try {
    let contract_721 = await ERC721CONTRACT.findOne({
      address: contractAddress,
      isAppropriate: false,
    })
    if (contract_721) {
      bannedCollections.set(contractAddress, true)
      return true
    } else {
      bannedCollections.set(contractAddress, false)
      return false
    }
  } catch (error) {
    return false
  }
}
const removeLike = async (contractAddress, tokenID) => {
  try {
    await Like.remove({
      contractAddress: contractAddress,
      tokenID: tokenID,
    })
  } catch (error) {}
}

const trackerc721 = async (begin, end) => {
  try {
    let request = `${ftmScanApiURL}api?module=account&action=tokennfttx&address=${validatorAddress}&startblock=${begin}&endblock=${end}&sort=asc&apikey=${ftmScanApiKey}`
    let result = await axios.get(request)
    let tnxs = result.data.result

    console.log(`found ${tnxs?.length} new transactions...`);
    if (tnxs) {
      let last = tnxs[tnxs.length - 1]
      end = parseInt(last.blockNumber)
    }

    if (tnxs.length == 0) return end
    else {
      let promise = tnxs.map(async (tnx) => {
        let to = toLowerCase(tnx.to)
        let tokenID = parseInt(tnx.tokenID)
        let contractAddress = toLowerCase(tnx.contractAddress)

        let nft = await NFTITEM.findOne({
          contractAddress: contractAddress,
          tokenID: tokenID,
        })
        if (nft) {
          console.log(`token exists already ${contractAddress} ${tokenID}`)
          if (to == validatorAddress) {
            await removeLike(contractAddress, tokenID)
            await nft.remove()
          }
          if (nft.owner != to) {
            nft.owner = to
            let now = Date.now()
            try {
              if (nft.createdAt > now) nft.createdAt = now
            } catch (error) {}
            await nft.save()
          }
        } else {
          if (to == validatorAddress) {
            await removeLike(contractAddress, tokenID)
          } else {
            let sc = loadedContracts.get(contractAddress)
            if (!sc) {
              sc = contractutils.loadContractFromAddress(contractAddress)
              loadedContracts.set(contractAddress, sc)
            }
            let tokenURI = await sc.tokenURI(tokenID)
            // if (tokenURI.startsWith('https://')) {
            let tokenName = '.'
            let imageURL = '.'
            try {
              let metadata = await axios.get(tokenURI)
              tokenName = metadata.data.name
              imageURL = metadata.data.image
                ? metadata.data.image
                : metadata.data
            } catch (error) {}
            let newTk = new NFTITEM()
            newTk.contractAddress = contractAddress
            newTk.tokenID = tokenID
            newTk.name = tokenName
            newTk.tokenURI = tokenURI
            newTk.imageURL = imageURL
            newTk.owner = to
            newTk.createdAt = new Date(parseInt(tnx.timeStamp) * 1000)
            let isBanned = await isBannedCollection(contractAddress)
            newTk.isAppropriate = !isBanned
            await newTk.save()
            console.log(`new token of ${contractAddress}, ${tokenID} saved`)
            // }
          }
        }
      })
      // await Promise.all(promise)
    }
    return end
  } catch (error) {
    // console.log(error)
  }
}

let start = process.env.START_BLOCKNUMBER

const trackAll721s = async () => {
  const func = async () => {
    try {
      let currentBlockHeight = await provider.getBlockNumber()
      start = await trackerc721(start, currentBlockHeight)
      if (currentBlockHeight > limit) start = 0
      setTimeout(async () => {
        await func()
      }, 1000 * 2)
    } catch (error) {}
  }
  await func()
}

module.exports = trackAll721s
