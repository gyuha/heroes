"""8-bit RGB/RGBA PNG tools. Bytes are sRGB; glTF COLOR_0 is linear."""
import struct,zlib,math
TERRAIN_SRGB={'grass':'78866A','forest':'3F5C4E','rock':'788087','sand':'A28362'}
PALETTE=[(200,200,200,255),(40,50,61,0),(230,220,196,0),(135,150,156,0),(101,80,68,0),(174,125,83,0)]
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def srgb(v):return 12.92*v if v<=.0031308 else 1.055*max(0,v)**(1/2.4)-.055
def png_read(data):
 assert data[:8]==b'\x89PNG\r\n\x1a\n';p=8;payload=b''
 while p<len(data):
  n=struct.unpack_from('>I',data,p)[0];tag=data[p+4:p+8];chunk=data[p+8:p+8+n];p+=n+12
  if tag==b'IHDR':w,h,depth,kind,comp,filt,interlace=struct.unpack('>IIBBBBB',chunk);assert depth==8 and kind in [2,6] and interlace==0
  if tag==b'IDAT':payload+=chunk
 channels=3 if kind==2 else 4;stride=w*channels;raw=zlib.decompress(payload);out=bytearray();prev=bytearray(stride)
 for y in range(h):
  typ=raw[y*(stride+1)];row=bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
  for x in range(stride):
   a=row[x-channels] if x>=channels else 0;b=prev[x];c=prev[x-channels] if x>=channels else 0
   if typ==1:v=a
   elif typ==2:v=b
   elif typ==3:v=(a+b)//2
   elif typ==4:
    t=a+b-c;ds=[abs(t-a),abs(t-b),abs(t-c)];v=[a,b,c][ds.index(min(ds))]
   else:assert typ==0;v=0
   row[x]=(row[x]+v)&255
  out+=row;prev=row
 return w,h,channels,out
def png_write(w,h,ch,pixels):
 def chunk(tag,value):return struct.pack('>I',len(value))+tag+value+struct.pack('>I',zlib.crc32(tag+value)&0xffffffff)
 raw=b''.join(b'\0'+bytes(pixels[y*w*ch:(y+1)*w*ch]) for y in range(h))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2 if ch==3 else 6,0,0,0))+chunk(b'sRGB',b'\0')+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
def mean_rgb(data):
 w,h,ch,p=png_read(data);return [sum(p[c::ch])/(w*h) for c in range(3)]
def hexmean(data):return '#'+''.join(f'{round(v):02X}' for v in mean_rgb(data))
def palette_png():
 p=bytearray()
 for y in range(256):
  for x in range(256):p.extend(PALETTE[min(5,x//42)])
 return png_write(256,256,4,p)
def validate_palette(data):
 w,h,ch,p=png_read(data);assert (w,h,ch)==(256,256,4)
 for i,target in enumerate(PALETTE):
  for y in range(h):
   for x in range(i*42,min((i+1)*42,256) if i<5 else 256):
    actual=p[(y*w+x)*4:(y*w+x)*4+4];assert all(abs(a-b)<=1 for a,b in zip(actual,target)),f'Palette cell {i}: {tuple(actual)} != sRGB {target}'
