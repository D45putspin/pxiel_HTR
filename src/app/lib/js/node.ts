import { storeAPI } from "../store";

export const updateCurrentCounter = async () => {
    const endpoint = process.env.NEXT_PUBLIC_HATHOR_COUNTER_QUERY || 'https://node1.testnet.hathor.network/v1a/abci_query?path=%22/get/con_counter.counter%22';
    const request = await fetch(endpoint);
    const data = await request.json();
    // @ts-ignore
    const setCounterValue = storeAPI.getState().setCounterValue;
    setCounterValue(atob(data.result.response.value));
}
