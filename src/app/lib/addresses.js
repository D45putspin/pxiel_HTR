export const CONTRACT_NAME = process.env.NEXT_PUBLIC_CANVAS_CONTRACT || 'con_pixel_canvas4';
export const DEFAULT_SIZE = parseInt(process.env.NEXT_PUBLIC_CANVAS_SIZE || '32', 10);
export const PIXEL_PRICE_WEI = process.env.NEXT_PUBLIC_PIXEL_PRICE_WEI || '1000000000000000000'; // 1 HTR expressed in smallest unit (default 10^18)
