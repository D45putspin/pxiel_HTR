
import HathorWalletUtils from './js/hathor-dapp-utils.js';

export default class WalletUtilService {
  static instance;

  constructor() {
    if (WalletUtilService.instance) {
      return WalletUtilService.instance;
    }
    this.HathorWalletUtils = HathorWalletUtils;
    this.walletUtils = this.HathorWalletUtils;
    WalletUtilService.instance = this;
  }

  static getInstance() {
    if (!WalletUtilService.instance) {
      new WalletUtilService();
    }
    return WalletUtilService.instance;
  }
}
