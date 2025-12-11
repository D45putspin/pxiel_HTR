import { storeAPI } from "../store";
import { updateCurrentCounter } from "./node";
import * as bulmaToast from "bulma-toast";

const showToast = (message: string, type: bulmaToast.ToastType) => {
    bulmaToast.toast({
        message,
        type,
        position: "top-center",
        duration: 5000
    });
}

const setWalletAddressElementValue = storeAPI.getState().setWalletAddressElementValue

export const handleWalletInfo = (info) => {
    setWalletAddressElementValue(info?.address?.slice(0, 10) + '...');
    if (info?.locked) {
        setWalletAddressElementValue('Wallet is Locked');
        showToast("Your wallet is locked. Please unlock it to interact with the dapp.", "is-warning");
    }
}

export const handleWalletError = (error) => {
    console.error('Wallet error:', error);
    showToast("You don't have the Hathor Wallet extension installed. Please install it to interact with the dapp.", "is-danger");
    setWalletAddressElementValue('Wallet not installed');
}

export const handleTransaction = (response) => {
    if (!response) {
        console.error('Transaction failed: No response received');
        showToast("Transaction failed: No response received", "is-danger");
        return;
    }
    if (response.errors) {
        console.error('Transaction failed:', response.errors);
        showToast("Transaction failed: " + response.errors, "is-danger");
        return;
    }
    console.log('Transaction succeeded:', response);
    showToast("Transaction succeeded", "is-success");
    updateCurrentCounter();
}

export const handleTransactionError = (error) => {
    console.error('Transaction error:', error);
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    showToast("Transaction error: " + errorMessage, "is-danger");
}

// New handlers for voting system
export const handlePollCreation = (response) => {
    console.log('Poll creation response:', response);

    if (response && response.errors) {
        console.error('Poll creation failed:', response.errors);
        showToast("Poll creation failed: " + response.errors, "is-danger");
        return;
    }

    // If response is null, it might still be successful (no return value from contract)
    // If response exists and has no errors, it's successful
    if (!response || response.result || response.success || response.txid) {
        console.log('Poll created successfully:', response);
        showToast("Poll created successfully! 🎉", "is-success");
    } else {
        console.error('Poll creation failed: Unexpected response format:', response);
        showToast("Poll creation failed: Unexpected response format", "is-danger");
    }
}

export const handleVoteSubmission = (response) => {
    console.log('Vote submission response:', response);

    if (response && response.errors) {
        console.error('Vote submission failed:', response.errors);
        showToast("Vote submission failed: " + response.errors, "is-danger");
        return;
    }

    // If response is null, it might still be successful (no return value from contract)
    // If response exists and has no errors, it's successful
    if (!response || response.result || response.success || response.txid) {
        console.log('Vote submitted successfully:', response);
        showToast("Vote submitted successfully! ✅", "is-success");
    } else {
        console.error('Vote submission failed: Unexpected response format:', response);
        showToast("Vote submission failed: Unexpected response format", "is-danger");
    }
}

export const handlePollError = (error) => {
    console.error('Poll operation error:', error);
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    showToast("Poll operation error: " + errorMessage, "is-danger");
}

// Make functions available globally
if (typeof window !== 'undefined') {
    (window as any).handleWalletInfo = handleWalletInfo;
    (window as any).handleWalletError = handleWalletError;
}