"""Reference-image triage only; source pixels and artistic review remain untouched."""
from pathlib import Path
import sys, json, hashlib, subprocess, csv, io, math
sys.path.insert(0,str(Path.cwd()/'work/spikes/look/references/analysis-deps'))
import cv2
import numpy as np
ROOT=Path.cwd()
BASE=ROOT/'docs/spikes/evidence/look/references'
RAW=ROOT/'work/spikes/look/references/screening'

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def perspective(rgb):
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    edges=cv2.Canny(gray,70,160)
    h,w=gray.shape; diagonal=math.hypot(w,h)
    found=cv2.HoughLinesP(edges,1,np.pi/720,threshold=60,minLineLength=int(diagonal*.065),maxLineGap=7)
    if found is None:return {'status':'inconclusive','reason':'No sufficiently long straight edges','families':[]}
    lines=found.reshape(-1,4).astype(float);delta=lines[:,2:]-lines[:,:2];length=np.linalg.norm(delta,axis=1)
    angle=np.degrees(np.arctan2(delta[:,1],delta[:,0]))%180;mid=(lines[:,2:]+lines[:,:2])/2
    families=[]
    for lo,hi in [(10,60),(70,110),(120,170)]:
        member=(angle>=lo)&(angle<=hi)
        if member.sum()<6:continue
        hist,bins=np.histogram(angle[member],bins=np.arange(lo,hi+.5,.5),weights=length[member])
        peak=(bins[hist.argmax()]+bins[hist.argmax()+1])/2
        selected=member&(np.abs(angle-peak)<=10)
        a=angle[selected];weights=length[selected];centers=mid[selected]
        if len(a)<6:continue
        theta=np.radians(peak);coordinate=centers@np.array([-np.sin(theta),np.cos(theta)])
        center=np.average(coordinate,weights=weights);mean=np.average(a,weights=weights)
        variance=np.average((coordinate-center)**2,weights=weights)
        if variance<1:continue
        slope=np.average((coordinate-center)*(a-mean),weights=weights)/variance
        predicted=mean+slope*(coordinate-center)
        total=np.sum(weights*(a-mean)**2);residual=np.sum(weights*(a-predicted)**2)
        r2=1-residual/total if total>1e-10 else 0
        span=float(np.quantile(coordinate,.95)-np.quantile(coordinate,.05));swing=abs(slope)*span
        flagged=bool(len(a)>=6 and span>=diagonal*.18 and r2>=.60 and swing>=4.0)
        families.append({'dominant_degrees':float(peak),'segments':int(len(a)),'position_span_pixels':span,'fitted_angle_swing_degrees':float(swing),'weighted_r_squared':float(r2),'convergence_flag':flagged})
    flagged=any(f['convergence_flag']for f in families)
    return {'status':'rejected_by_heuristic'if flagged else ('no_convergence_flag'if len(families)>=2 else 'inconclusive'),'long_segments':int(len(lines)),'families':families,'limit':'This estimates spatial change in edge angles, not camera calibration. Parallel-line confidence and perspective truth require Claude review; absence of a flag is not proof of orthographic projection.'}

def orange(rgb,theme,out):
    floating=rgb.astype(np.float32)/255
    lab=cv2.cvtColor(floating,cv2.COLOR_RGB2LAB)
    target=np.array([[[240,100,10]if theme=='day'else[255,122,26]]],dtype=np.float32)/255
    target_lab=cv2.cvtColor(target,cv2.COLOR_RGB2LAB)[0,0]
    distance=np.linalg.norm(lab-target_lab,axis=2)
    hsv=cv2.cvtColor(floating,cv2.COLOR_RGB2HSV)
    mask=((distance<=45)&(hsv[:,:,0]<=36)&(hsv[:,:,1]>=.60)).astype(np.uint8)*255
    # Close hairline gaps within a painted part; keep separate distant accents separate.
    closed=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
    n,labels,stats,_=cv2.connectedComponentsWithStats(closed,8)
    minimum=max(24,round(rgb.shape[0]*rgb.shape[1]*.00002))
    components=[]
    for i in range(1,n):
        x,y,w,h,area=stats[i]
        if area>=minimum:components.append({'bbox':[int(x),int(y),int(w),int(h)],'area_pixels':int(area)})
    components.sort(key=lambda a:-a['area_pixels'])
    cv2.imwrite(str(out/'orange-mask.png'),mask)
    return {'count':len(components),'components':components,'minimum_component_pixels':minimum,'raw_pixel_count':int((mask>0).sum()),'lab_distance_threshold':45,'hue_degrees_maximum':36,'saturation_minimum':.60,'closing_kernel_pixels':7,'palette_source':'Product starting accent values, used only for screening; no Part B tone selection.','limit':'Shade, occlusion and unrelated warm material can split or merge an apparent part. Count is a reproducible palette-mask heuristic, not semantic ownership of the accent.'}

def ocr(path,out):
    reports=[];tokens=[]
    for mode in [11,6]:
        result=subprocess.run(['tesseract',str(path),'stdout','--psm',str(mode),'-l','eng','tsv'],capture_output=True,text=True,check=True)
        (out/f'ocr-psm-{mode}.tsv').write_text(result.stdout)
        for row in csv.DictReader(io.StringIO(result.stdout),delimiter='\t'):
            token=(row.get('text')or'').strip();confidence=float(row.get('conf')or'-1')
            if token and confidence>=70 and any(c.isalnum()for c in token):
                # Single scale-like marks are recorded but require a stronger OCR confidence.
                letters=sum(c.isalnum()for c in token)
                if letters>=2 or confidence>=90:
                    item={'text':token,'confidence':confidence,'psm':mode,'bbox':[int(row[x])for x in ['left','top','width','height']]}
                    tokens.append(item)
        reports.append({'psm':mode,'tsv':str((out/f'ocr-psm-{mode}.tsv').relative_to(ROOT))})
    return {'flagged_tokens':tokens,'runs':reports,'confidence_threshold':70,'single_character_threshold':90,'limit':'OCR can confuse engraved marks or simple geometric emblems with glyphs. Flags are automatic exclusions for review, not verified transcription. Screen-frame captions are blank type strokes, so readable glyphs still need review.'}

def run(path):
    path=path.resolve()
    group=path.parents[1].name;theme=group.rsplit('-',1)[-1];identifier=path.stem
    out=RAW/group/'001'/identifier;out.mkdir(parents=True,exist_ok=True)
    decoded=cv2.imread(str(path),cv2.IMREAD_UNCHANGED)
    nonopaque=int(np.count_nonzero(decoded[:,:,3]<255)) if decoded.ndim==3 and decoded.shape[2]==4 else 0
    rgb=cv2.cvtColor(decoded,cv2.COLOR_BGRA2RGB if decoded.shape[2]==4 else cv2.COLOR_BGR2RGB)
    p=perspective(rgb);o=orange(rgb,theme,out);t=ocr(path,out)
    reasons=[]
    if nonopaque:reasons.append('unexpected_transparency')
    if p['status']=='rejected_by_heuristic':reasons.append('perspective_convergence_heuristic')
    if o['count']>1:reasons.append('multiple_orange_components')
    if o['count']==0:reasons.append('no_detected_orange_component')
    if t['flagged_tokens']:reasons.append('ocr_glyph_detection')
    report={'candidate':identifier,'frame':group,'image_sha256':digest(path),'width':int(rgb.shape[1]),'height':int(rgb.shape[0]),'screening_status':'rejected_by_automatic_screen'if reasons else 'not_flagged_by_automatic_screen','reasons':reasons,'nonopaque_pixels':nonopaque,'perspective':p,'orange':o,'ocr':t,'review':'Claude shortlist pending; this script makes no artistic approval.'}
    dest=path.with_suffix('.screening.json');dest.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'frame':group,'candidate':identifier,'status':report['screening_status'],'reasons':reasons,'orange':o['count'],'ocr':len(t['flagged_tokens'])}),flush=True)
    return report

if __name__=='__main__':
    paths=[Path(x)for x in sys.argv[1:]]if len(sys.argv)>1 else sorted(BASE.glob('*/001/candidate-*.png'))
    for path in paths:run(path)
