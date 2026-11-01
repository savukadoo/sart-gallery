"""Measure the rendered Off/On comparison; do not alter captured frames."""
from pathlib import Path
import json
from PIL import Image,ImageChops,ImageStat
ROOT=Path(__file__).resolve().parents[1]
def compare(mode):
    first=Image.open(ROOT/f'.local/qa/motion-{mode}-first.jpg').convert('RGB')
    second=Image.open(ROOT/f'.local/qa/motion-{mode}-second.jpg').convert('RGB')
    assert first.size==second.size
    w,h=first.size
    centre=(int(w*.3),int(h*.3),int(w*.7),int(h*.7));frame=(int(w*.2),8,int(w*.8),25)
    delta=ImageChops.difference(first.crop(centre),second.crop(centre))
    edge=ImageChops.difference(first.crop(frame),second.crop(frame))
    return {'artworkMeanDifference':sum(ImageStat.Stat(delta).mean)/3,
            'changedArtworkFraction':sum(max(p)>5 for p in delta.get_flattened_data())/(delta.width*delta.height),
            'frameMeanDifference':sum(ImageStat.Stat(edge).mean)/3}
def main():
    result={'version':'0.6.4','off':compare('off'),'on':compare('on')}
    assert result['off']['artworkMeanDifference']<.1,'Off is not stationary'
    assert result['on']['artworkMeanDifference']>3,'On does not show sufficient painted motion'
    assert result['on']['changedArtworkFraction']>.1,'On is not visibly distinct in the rendered frames'
    assert result['on']['frameMeanDifference']<.01,'The frame should remain still'
    (ROOT/'.local/qa/motion-on-off-painted.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
