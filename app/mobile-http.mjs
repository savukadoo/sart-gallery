import {hasOwn} from './compat.mjs';
// Strict, bounded HTTP/1.1 subset for the temporary LAN server.
export function mobileParseRequest(bytes,expectedHost){
 if(bytes.length>70000)throw new Error('413');
 let end=-1;for(let i=0;i+3<bytes.length;i++)if(bytes[i]===13&&bytes[i+1]===10&&bytes[i+2]===13&&bytes[i+3]===10){end=i;break;}
 if(end<0){if(bytes.length>8192)throw new Error('431');return null;}
 if(end>8192)throw new Error('431');
 const lines=new TextDecoder().decode(bytes.subarray(0,end)).split('\r\n'),start=/^(GET|POST) (\/[a-zA-Z0-9./_-]*) HTTP\/1\.[01]$/.exec(lines.shift());if(!start)throw new Error('400');
 const headers={};for(const line of lines){const match=/^([A-Za-z0-9-]+):[ \t]*([^\r\n]*)$/.exec(line);if(!match)throw new Error('400');const name=match[1].toLowerCase();if(hasOwn(headers,name))throw new Error('400');headers[name]=match[2].trim();}
 if(headers.host!==expectedHost||headers['transfer-encoding']||headers.expect)throw new Error('400');
 if(headers.origin&&headers.origin!=='https://'+expectedHost)throw new Error('403');
 if(headers['sec-fetch-site']==='cross-site')throw new Error('403');
 const length=headers['content-length']===undefined?0:Number(headers['content-length']);if(!Number.isSafeInteger(length)||length<0||length>60000||!/^\d+$/.test(headers['content-length']||'0'))throw new Error('413');
 if(start[1]==='GET'&&length)throw new Error('400');
 if(bytes.length<end+4+length)return null;
 if(bytes.length!==end+4+length)throw new Error('400');
 return {method:start[1],path:start[2],headers,body:new TextDecoder().decode(bytes.subarray(end+4))};
}
export function mobileHttpResponse(status,body,type='application/json'){
 const bytes=typeof body==='string'?new TextEncoder().encode(body):body;
 const names={200:'OK',400:'Bad Request',401:'Unauthorised',403:'Forbidden',404:'Not Found',409:'Conflict',410:'Gone',413:'Content Too Large',429:'Too Many Requests',431:'Headers Too Large',500:'Server Error',503:'Unavailable'};
 const header=new TextEncoder().encode(`HTTP/1.1 ${status} ${names[status]||'Error'}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n\r\n`);
 const result=new Uint8Array(header.length+bytes.length);result.set(header);result.set(bytes,header.length);return result;
}
