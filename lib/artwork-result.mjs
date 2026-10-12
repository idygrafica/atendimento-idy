export class ImageResultError extends Error{constructor(message){super(message);this.status=502;}}
export function resultImage(value){
  if(typeof value!=='string'||value.length>4000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new ImageResultError('A prévia retornou em um formato inesperado.');
  const bytes=Buffer.from(value,'base64');
  if(bytes[0]===255&&bytes[1]===216)return 'data:image/jpeg;base64,'+value;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'data:image/png;base64,'+value;
  throw new ImageResultError('Não foi possível mostrar a imagem gerada.');
}
