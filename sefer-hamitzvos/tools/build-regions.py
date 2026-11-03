"""Independently verify native-resolution region definitions from shipped line art.
Requires Pillow, numpy and scipy. Does not edit artwork or saved coloring.
"""
from pathlib import Path
import json, hashlib, io
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[1]
def regions(path):
    rgba=np.array(Image.open(path).convert('RGBA'))
    h,w=rgba.shape[:2]
    # Anti-aliased pixels are part of the barrier, not the fillable white paper.
    paper=(rgba[:,:,:3].min(axis=2)>=232)&(rgba[:,:,3]>0)
    ink=~paper
    radius=max(2,round(min(w,h)/180))
    # Closing repairs short breaks without expanding every outline into tiny interiors.
    barrier=ndi.binary_closing(ink,structure=np.ones((2*radius+1,)*2),border_value=1)|ink
    labels,count=ndi.label(~barrier)
    sizes=np.bincount(labels.ravel())
    edge=np.unique(np.concatenate((labels[0],labels[-1],labels[:,0],labels[:,-1])))
    invalid=np.zeros(count+1,dtype=bool);invalid[edge]=True;invalid[0]=True
    # Refuse ambiguous background/whole-page components even inside a printed frame.
    invalid|=sizes>w*h*.18
    labels[invalid[labels]]=0
    # Labels remain zero on ALL source ink, even where morphology changed the mask.
    labels[~paper]=0
    return labels.astype(np.uint32),rgba,radius

def main():
    manifest={}
    for n in range(1,614):
        family='coloring-v2' if 475<=n<=503 else 'coloring'
        source=ROOT/family/f'{n:03}.png'
        labels,rgba,radius=regions(source)
        rgb=np.stack((labels&255,(labels>>8)&255,(labels>>16)&255),axis=2).astype('uint8')
        manifest[str(n)]={'source':family+f'/{n:03}.png','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'width':labels.shape[1],'height':labels.shape[0],'closingRadius':radius,'regions':len(np.unique(labels))-1,'labelsSha256':hashlib.sha256(labels.astype('<u4').tobytes()).hexdigest()}
    (ROOT/'region-manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print('Verified',len(manifest),'native-resolution region definitions')
if __name__=='__main__':main()
