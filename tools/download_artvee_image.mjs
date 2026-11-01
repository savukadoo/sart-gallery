// Resolve only Artvee's public free Standard JPEG through the existing adapter.
import fs from 'node:fs/promises';import {FindArtCatalog} from '../app/find-art.mjs';
const [id,destination]=process.argv.slice(2),records=JSON.parse(await fs.readFile(new URL('../design/artwork-research/artvee-selected-014.json',import.meta.url))).data;
const record=records.find(r=>r.providerId===Number(id));if(!record)throw Error('Artwork is not in the curated Artvee list');
const image=await new FindArtCatalog().image(record);await fs.writeFile(destination,new Uint8Array(await image.arrayBuffer()));
