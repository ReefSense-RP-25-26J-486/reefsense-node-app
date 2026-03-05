const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function uploadBufferToCloudinary(buffer, uploadOpts = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(uploadOpts, (error, result) => {
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
  console.log(`[Cloudinary] Uploading original image (${buffer.length} bytes)…`);
  const result = await uploadBufferToCloudinary(buffer, {
    folder:        'reefsense/originals',
    resource_type: 'image',
    public_id:     `original_${Date.now()}`,
    quality:       'auto:best',
    context:       `filename=${filename || 'reef_image'}|source=reefsense_api`,
  });
  console.log(`[Cloudinary] Original uploaded → ${result.secure_url}`);
  return { url: result.secure_url, publicId: result.public_id };
}

async function uploadAnnotatedImage(base64String, mimeType) {
  console.log(`[Cloudinary] Uploading annotated image…`);
  const dataUri = `data:${mimeType};base64,${base64String}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder:        'reefsense/annotated',
    resource_type: 'image',
    public_id:     `annotated_${Date.now()}`,
    quality:       'auto:best',
    context:       'source=reefsense_api|type=annotated',
  });
  console.log(`[Cloudinary] Annotated uploaded → ${result.secure_url}`);
  return { url: result.secure_url, publicId: result.public_id };
}

module.exports = { uploadOriginalImage, uploadAnnotatedImage };
