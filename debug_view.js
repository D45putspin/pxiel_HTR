
const WALLET_TARGET = 'http://localhost:8000';
const NC_ID = '00005a0ce0f5cf14c7ce1d0d3e950d8e865030779fa51c57e16f5c028d1d3750';
const WALLET_ID = 'alice';

async function testCall(callStr) {
    const url = new URL(`${WALLET_TARGET}/wallet/nano-contracts/state`);
    url.searchParams.append('id', NC_ID);
    url.searchParams.append('calls[]', callStr);

    console.log(`Testing call: ${callStr}`);
    try {
        const res = await fetch(url.toString(), {
            headers: { 'X-Wallet-Id': WALLET_ID }
        });
        const txt = await res.text();
        console.log(`Status: ${res.status}`);
        console.log(`Body: ${txt}`);
    } catch (e) {
        console.error(`Error: ${e.message}`);
    }
    console.log('---');
}

async function testField(fieldParam) {
    const url = new URL(`${WALLET_TARGET}/wallet/nano-contracts/state`);
    url.searchParams.append('id', NC_ID);
    url.searchParams.append('fields[]', fieldParam);

    console.log(`Testing field: ${fieldParam}`);
    try {
        const res = await fetch(url.toString(), {
            headers: { 'X-Wallet-Id': WALLET_ID }
        });
        const txt = await res.text();
        console.log(`Status: ${res.status}`);
        console.log(`Result: ${txt}`);
    } catch (e) {
        console.error(`Error: ${e.message}`);
    }
    console.log('---');
}

async function run() {
    await testCall('get_stats()');
    await testCall('get_pixel_info(0,0)');
    // Test a coordinate likely to be empty
    await testCall('get_pixel_info(1,1)');
}

run();
