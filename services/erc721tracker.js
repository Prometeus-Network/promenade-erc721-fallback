require("dotenv").config();
const axios = require("axios");
const mongoose = require("mongoose");
const ethers = require("ethers");

const rpcapi = process.env.NETWORK_RPC;
const chainID = parseInt(process.env.NETWORK_CHAINID);
const ftmScanApiURL = process.env.FTM_SCAN_URL;

const provider = new ethers.providers.JsonRpcProvider(rpcapi, chainID);

const NFTITEM = mongoose.model("NFTITEM");
const ERC721CONTRACT = mongoose.model("ERC721CONTRACT");
const Like = mongoose.model("Like");

const contractutils = require("./contract.utils");

const ftmScanApiKey = process.env.FTM_SCAN_API_KEY;
const validatorAddress = process.env.VALIDATORADDRESS;
const limit = 99999999999999;

const toLowerCase = (val) => {
  if (val) return val.toLowerCase();
  else return val;
};

const loadedContracts = new Map();

const bannedCollections = new Map();

const isBannedCollection = async (contractAddress) => {
  let isBanned = bannedCollections.get(contractAddress);
  if (isBanned) return true;
  try {
    let contract_721 = await ERC721CONTRACT.findOne({
      address: contractAddress,
      isAppropriate: false,
    });
    if (contract_721) {
      bannedCollections.set(contractAddress, true);
      return true;
    } else {
      bannedCollections.set(contractAddress, false);
      return false;
    }
  } catch (error) {
    console.error("Error while performing isBannedCollection: ", error);
    return false;
  }
};
const removeLike = async (contractAddress, tokenID) => {
  try {
    await Like.remove({
      contractAddress: contractAddress,
      tokenID: tokenID,
    });
  } catch (error) {
    console.error("Error while performing removeLike: ", error);
  }
};

const trackerc721 = async (begin, end) => {
  try {
    let request = `${ftmScanApiURL}api?module=account&action=tokennfttx&address=${validatorAddress}&startblock=${begin}&endblock=${end}&sort=asc&apikey=${ftmScanApiKey}`;
    let result = await axios.get(request);
    let tnxs = result.data.result;

    console.log("start:", start);
    console.log("end: ", end);

    console.log(`found ${tnxs?.length} new transactions...`);

    if (!tnxs || tnxs.length == 0) {
      return end;
    }
    for (let i = 0; i < tnxs.length; i++) {
      const tnx = tnxs[i];
      let to = toLowerCase(tnx.to);
      let tokenID = parseInt(tnx.tokenID);
      let contractAddress = toLowerCase(tnx.contractAddress);

      let nft = await NFTITEM.findOne({
        contractAddress: contractAddress,
        tokenID: tokenID,
      });

      if (nft) {
        console.log(`token exists already ${contractAddress} ${tokenID}`);
        if (to == validatorAddress) {
          await removeLike(contractAddress, tokenID);
          await nft.remove();
          return end;
        }
        if (nft.contractAddress == "0x954d9ec10bb19b64ef07603c102f5bbd75216276") {
          try {
            let sc = contractutils.loadContractFromAddress(contractAddress);
            loadedContracts.set(contractAddress, sc);
            console.log("trying to get imageData")
            const imageData = await sc.imageData(tokenID);
            nft.tokenURI = `https://ipfs.sy.finance/ipfs/${imageData.nftData}`;
            nft.name = imageData.name;
            nft.imageURL = nft.tokenURI;
            await nft.save();
            console.log(`saving new tokenURI: ${nft.tokenURI} and name: ${nft.name} for ${nft.contractAddress}`)
          } catch(error) {
            console.error(`failed to call imageData for ${nft.contractAddress} reason: `, error)
          }
        }
        
        if (nft.owner != to) {
          nft.owner = to;
          let now = Date.now();
          try {
            if (nft.createdAt > now) nft.createdAt = now;
          } catch (error) {
            console.error("Error while performing nft.createdAt: ", error);
          }
          if (nft.contractAddress == "0x954d9ec10bb19b64ef07603c102f5bbd75216276") {
            console.log(nft);
          }
          await nft.save();
        }
      } else {
        if (to == validatorAddress) {
          await removeLike(contractAddress, tokenID);
        } else {
          let sc = loadedContracts.get(contractAddress);
          if (!sc) {
            sc = contractutils.loadContractFromAddress(contractAddress);
            loadedContracts.set(contractAddress, sc);
            console.log("going now with: ", contractAddress)
          }
          let tokenURI;
          try {
            tokenURI= await sc.tokenURI(tokenID);
          } catch {
            console.error(`Failed to call tokenURI method: ${contractAddress}`)
          }
       
          // if (tokenURI.startsWith('https://')) {
          let tokenName = ".";
          let imageURL = ".";
          try {
            let metadata = await axios.get(tokenURI);
            tokenName = metadata.data.name;
            imageURL = metadata.data.image
              ? metadata.data.image
              : metadata.data;
          } catch (error) {}
          if (typeof imageURL === "object" && "imageurl" in imageURL) {
            imageURL = imageURL.imageurl;
          }

          if (typeof imageURL === "object") {
            imageURL = JSON.stringify(imageURL);
            console.error('NFT Image is incorrect')
          }
          if (typeof tokenName === "object") {
            tokenName = JSON.stringify(tokenName);
            console.error('NFT Name is incorrect')
          }

          if (typeof tokenName === "object") {
            tokenName = JSON.stringify(tokenName);
            console.error('NFT Name is incorrect')
          }
          if (contractAddress == "0x954d9ec10bb19b64ef07603c102f5bbd75216276") {
            try {
              console.log("getting imageData from new Punk nft... ")
              let imageData = await sc.imageData(tokenID);
              tokenURI = `https://ipfs.sy.finance/ipfs/${imageData.nftData}`;
              imageURL = tokenURI;
              tokenName = imageData.name;
              console.log(`saving custom tokenURI: ${tokenURI} and name: ${tokenName} for ${contractAddress}`)
            } catch(error) {
              console.error(`failed to initially call imageData for ${contractAddress} with error: `, error )
          }
        }

          let newTk = new NFTITEM();
          newTk.contractAddress = contractAddress;
          newTk.tokenID = tokenID;
          newTk.name = tokenName;
          newTk.tokenURI = tokenURI || "empty";
          newTk.imageURL = imageURL;
          newTk.owner = to;
          newTk.createdAt = new Date(parseInt(tnx.timeStamp) * 1000);
          let isBanned = await isBannedCollection(contractAddress);
          newTk.isAppropriate = !isBanned;
          await newTk.save();
          console.log(`new token of ${contractAddress}, ${tokenID} saved`);
        }
      }
    }

    return end;
  } catch (error) {
    console.log("Error while performing trackerc721: ", error);
    // console.log(error)
    return start;
  }
};

let start = process.env.START_BLOCKNUMBER;

const trackAll721s = async () => {
  const func = async () => {
    try {
      let currentBlockHeight = await provider.getBlockNumber();
      const end =
        parseInt(start, 10) +
        parseInt(process.env.BLOCKS_PER_SEARCH || 5000, 10);
      start = await trackerc721(
        start,
        currentBlockHeight > end ? end : currentBlockHeight
      );

      setTimeout(async () => {
        await func();
      }, 500);
    } catch (error) {
      console.error("Error while performing trackAll721s: ", error);
    }
  };
  await func();
};

module.exports = trackAll721s;
