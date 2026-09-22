import { decodeImageDataUri } from '@shared/imageDataUri';

export function imageDataUriToBlob(uri: string): Blob {
    const image = decodeImageDataUri(uri);
    return new Blob([image.bytes], { type: image.mimeType });
}

async function rasterizePng(blob: Blob): Promise<Blob> {
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Image conversion timed out')), 10000);
            image.onload = () => { clearTimeout(timer); resolve(); };
            image.onerror = () => { clearTimeout(timer); reject(new Error('Image conversion failed')); };
            image.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context || !canvas.width || !canvas.height) {
            throw new Error('Image conversion failed');
        }
        context.drawImage(image, 0, 0);
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image conversion failed')), 'image/png');
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function copyImageToClipboard(uri: string): Promise<void> {
    const Item = window.ClipboardItem;
    if (!navigator.clipboard?.write || !Item) {
        throw new Error('Image clipboard is unavailable');
    }
    let blob = imageDataUriToBlob(uri);
    if (Item.supports && !Item.supports(blob.type)) {
        if (!Item.supports('image/png')) {
            throw new Error('Image clipboard is unavailable');
        }
        blob = await rasterizePng(blob);
    }
    await navigator.clipboard.write([new Item({ [blob.type]: blob })]);
}
