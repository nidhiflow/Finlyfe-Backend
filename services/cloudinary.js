import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a base64 image to Cloudinary
 * @param {string} base64Data - base64 string (with or without data:image prefix)
 * @param {string} folder - Cloudinary folder name
 * @returns {string} Cloudinary secure URL
 */
export async function uploadImage(base64Data, folder = 'finly/receipts') {
    if (!base64Data) return null;

    if (base64Data.startsWith('http://') || base64Data.startsWith('https://')) {
        return base64Data;
    }

    const dataUri = base64Data.startsWith('data:')
        ? base64Data
        : `data:image/jpeg;base64,${base64Data}`;

    try {
        const result = await cloudinary.uploader.upload(dataUri, {
            folder,
            resource_type: 'image',
            quality: 'auto:good',
            format: 'webp',
        });
        return result.secure_url;
    } catch (err) {
        console.error('Cloudinary upload error:', err.message);
        return base64Data;
    }
}

/**
 * Delete an image from Cloudinary by URL
 * @param {string} url - Cloudinary URL
 */
export async function deleteImage(url) {
    if (!url || !url.includes('cloudinary')) return;

    try {
        // The public ID is whatever follows "/upload/", minus the optional version
        // segment (v123/) and file extension. Anchoring on "/upload/" rather than the
        // first "finly" segment keeps this correct if the cloud name is itself "finly".
        const afterUpload = url.split('/upload/')[1];
        if (!afterUpload) return;
        const publicId = afterUpload.replace(/^v\d+\//, '').replace(/\.[^/.]+$/, '');
        await cloudinary.uploader.destroy(publicId);
    } catch (err) {
        console.error('Cloudinary delete error:', err.message);
    }
}

export default cloudinary;
