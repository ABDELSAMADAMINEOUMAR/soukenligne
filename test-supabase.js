require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

async function test() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const filename = `test_signed_upload_${Date.now()}.tmp`;
  console.log('Creating signed URL for:', filename);
  
  const { data, error } = await supabase.storage.from('products').createSignedUploadUrl(filename);
  if (error) {
    console.error('Error creating signed URL:', error);
    return;
  }
  
  console.log('Signed URL data:', data);
  
  // Create a dummy image buffer (fake PNG)
  const fakePng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  
  // Upload to signed URL using fetch
  console.log('Uploading using fetch PUT to signedUrl...');
  const uploadRes = await fetch(data.signedUrl, {
    method: 'PUT',
    body: fakePng,
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  });
  
  console.log('Upload response status:', uploadRes.status);
  const uploadText = await uploadRes.text();
  console.log('Upload response text:', uploadText);
  
  // Get public URL
  const { data: publicData } = supabase.storage.from('products').getPublicUrl(filename);
  console.log('Public URL:', publicData.publicUrl);
  
  // Download first 12 bytes
  const downloadRes = await fetch(publicData.publicUrl, { headers: { 'Range': 'bytes=0-11' } });
  console.log('Download range status:', downloadRes.status);
  
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  console.log('Downloaded bytes:', buffer);
  
  // Cleanup
  console.log('Deleting file...');
  await supabase.storage.from('products').remove([filename]);
  console.log('Done.');
}

test().catch(console.error);
