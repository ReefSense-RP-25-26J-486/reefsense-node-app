const cloudinary = require('cloudinary');
const { Readable } = require('stream');

// ── Bleaching component account (global config) ───────────────────────────────
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
// Species & Growth uploads pass their own credentials inline per-call (see uploadGrowthImage).

function uploadBufferToCloudinary(buffer, uploadOpts = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.v2.uploader.upload_stream(uploadOpts, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

async function uploadOriginalImage(buffer, mimeType, filename) {
  console.log(`[Cloudinary/bleaching] Uploading original image (${buffer.length} bytes)…`);
  const result = await uploadBufferToCloudinary(buffer, {
    folder:        'reefsense/originals',
    resource_type: 'image',
    public_id:     `original_${Date.now()}`,
    quality:       'auto:best',
    context:       `filename=${filename || 'reef_image'}|source=reefsense_api`,
  });
  console.log(`[Cloudinary/bleaching] Original uploaded → ${result.secure_url}`);
  return { url: result.secure_url, publicId: result.public_id };
}

async function uploadAnnotatedImage(base64String, mimeType) {
  console.log(`[Cloudinary/bleaching] Uploading annotated image…`);
  const dataUri = `data:${mimeType};base64,${base64String}`;
  const result = await cloudinary.v2.uploader.upload(dataUri, {
    folder:        'reefsense/annotated',
    resource_type: 'image',
    public_id:     `annotated_${Date.now()}`,
    quality:       'auto:best',
    context:       'source=reefsense_api|type=annotated',
  });
  console.log(`[Cloudinary/bleaching] Annotated uploaded → ${result.secure_url}`);
  return { url: result.secure_url, publicId: result.public_id };
}

// ── Growth-specific upload (dedicated account, credentials passed per-call) ────
async function uploadGrowthImage(base64String, mimeType) {
  console.log(`[Cloudinary/growth] Uploading coral growth image…`);
  const dataUri = `data:${mimeType};base64,${base64String}`;
  // Pass credentials explicitly so this never touches the bleaching account
  const result = await cloudinary.v2.uploader.upload(dataUri, {
    cloud_name:    process.env.GROWTH_CLOUDINARY_CLOUD_NAME,
    api_key:       process.env.GROWTH_CLOUDINARY_API_KEY,
    api_secret:    process.env.GROWTH_CLOUDINARY_API_SECRET,
    folder:        'reefsense-growth/corals',
    resource_type: 'image',
    public_id:     `coral_${Date.now()}`,
    quality:       'auto:best',
    context:       'source=reefsense_growth|type=annotated',
  });
  console.log(`[Cloudinary/growth] Coral image uploaded → ${result.secure_url}`);
  return { url: result.secure_url, publicId: result.public_id };
}

module.exports = { uploadOriginalImage, uploadAnnotatedImage, uploadGrowthImage };
