// Offline help uses the same feature gate as the Settings entry for native Art.
const TOPICS=[
  {id:'viewing',title:'Viewing artwork',steps:[
    'Use Left and Right to browse collections. Press OK on a collection, then choose an image to display it.',
    'While an image is displayed, press OK to reveal its controls. Use the chevrons to change images.',
    'Choose Favourite to add or remove the image from Favourites.',
    'Press Back to dismiss controls, return to a collection or leave a popup.'
  ],tip:'Saved photos and the included artwork remain available without an internet connection.'},
  {id:'uploads',title:'Add photos',steps:[
    'Keep the TV and your phone, tablet or computer on the same home Wi-Fi. Open Add photos on the TV.',
    'Scan the connection QR, or open the HTTPS address in your browser and enter the code shown on the TV.',
    'Approve the matching device on the TV. Choose an existing collection or create a new one in the upload page.',
    'Choose your photos and send them. Keep both screens open until the TV confirms the image name and collection.'
  ],tip:'For a new device, choose Set up this device first. The Connection help topic explains certificate setup. A separate PC companion is not needed.'},
  {id:'find-art',title:'Find art',steps:[
    'Open Find art and choose an enabled source. Manage sources is available there and in Settings.',
    'Open Search art to enter an artist or subject. Use the keyboard’s Done or Cancel to leave typing. Your last five searches are remembered.',
    'Open a result and choose a destination collection, or create a new one. Select images lets you add several results together.',
    'After adding images, choose Display now to show them immediately, or Keep browsing to continue searching.'
  ],tip:'Manage sources lets you turn sources on or off, choose a default, or test and add a Wikimedia Commons image category. The connected phone/PC page has an Art sources tab for easier typing. Removing a source keeps downloaded artwork. Searching needs internet; saved artwork stays available offline.'},
  {id:'collections',title:'Manage your images',steps:[
    'Collections are named groups of images. Choose a collection thumbnail to open it.',
    'To move an image, display it, press OK and choose Move to collection. Select an existing destination or create a new collection.',
    'Settings → Your photo library → Manage uploads lets you select several saved images to move or remove together.',
    'Remove from SART App deletes a saved upload or download. Included artwork is hidden instead and can return through Restore included artwork in Settings.'
  ],tip:'There is no recycle bin for deleted uploads or downloaded art. Upload or download them again if needed. Originals on your phone or computer stay there.'},
  {id:'display',title:'Artwork display',steps:[
    'Display an image, press OK and choose Frame & mat to change its frame, mat colour, paper edge and image fit.',
    'Bevelled thin and Bevelled thick add depth to the paper edge. Choose No mat to hide the paper surround.',
    'Use Brightness & contrast to adjust the artwork’s appearance. These controls change SART’s image, rather than the TV’s hardware picture settings.',
    'To set a shared look, open Settings → Frame & mat for all artwork → Choose look, then apply it to all artwork.'
  ],tip:'A shared look applies to existing and future images. You can customise an individual image again afterwards.'},
  {id:'slideshow',title:'Slideshow',steps:[
    'Choose Play all art, Play collection or Play favourites to start a slideshow from that selection.',
    'In artwork controls, use Slideshow to play or pause. The settings icon beside it opens slideshow options.',
    'Artwork timer sets how long each image stays. Transition duration sets how long the change between images takes.',
    'Choose the order, transition effect and optional Gentle pan & zoom. The chevrons still let you change images manually.'
  ],tip:'Press OK to reveal hidden artwork controls. Your timer and slideshow choices are saved on the TV.'},
  {id:'connection',title:'Connection help',steps:[
    'On the TV, open Add photos → Set up this device. Scan that setup QR to download this TV’s public certificate.',
    'Compare its fingerprint with Certificate details on the TV before installing and trusting it.',
    'On iPhone or iPad, install the downloaded profile, then enable trust under Settings → General → About → Certificate Trust Settings.',
    'Return to the TV, choose Back to connection and scan the HTTPS QR. Keep Add photos open; choose New code if a connection has expired.'
  ],tip:'To remove the iPhone profile later, use Settings → General → VPN & Device Management. Setup downloads use HTTP for public files only; photos and pairing use HTTPS.'},
  {id:'native-art',title:'Samsung Art Mode',native:true,steps:[
    'On a supported Frame, display an image, press OK and choose Samsung Art Mode. Turn on Include SART frame & mat to include its bevel and image fit.',
    'Check the preview, then choose Add & show in Art Mode. A matching saved copy says Already in Samsung Art and is reused. A changed look creates a separate copy.',
    'Settings → Samsung Art Mode → Manage collection lets you preview, show or delete images in Samsung’s My Photos library.',
    'Samsung’s Art Mode takes over the display and its own picture, mat, sleep and sensor settings. The SART original remains separate.'
  ],tip:'Deleting a native copy from Samsung Art does not delete its SART original. The optional styled copy includes SART’s decorative surround; Samsung’s picture settings still apply.'}
];
export const helpTopics=nativeArtSupported=>TOPICS.filter(topic=>!topic.native||nativeArtSupported);
