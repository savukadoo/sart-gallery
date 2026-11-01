"""Compare painted TV frames without modifying images or device settings."""
from pathlib import Path
import json
from PIL import Image,ImageChops,ImageStat
ROOT=Path(__file__).resolve().parents[1]
def measurements(mode):
    folder=ROOT/'.local/qa'
    first=Image.open(folder/f'motion-{mode}-first.png').convert('RGB')
    second=Image.open(folder/f'motion-{mode}-second.png').convert('RGB')
    assert first.size==second.size
    width,height=first.size
    artwork=(int(width*.3),int(height*.3),int(width*.7),int(height*.7))
    frame=(int(width*.2),8,int(width*.8),25)
    delta=ImageChops.difference(first.crop(artwork),second.crop(artwork))
    edge=ImageChops.difference(first.crop(frame),second.crop(frame))
    return {'meanArtworkDifference':sum(ImageStat.Stat(delta).mean)/3,
            'changedArtworkFraction':sum(max(pixel)>5 for pixel in delta.get_flattened_data())/(delta.width*delta.height),
            'meanFrameDifference':sum(ImageStat.Stat(edge).mean)/3}
def main():
    result={'old':measurements('old'),'fixed':measurements('fixed')}
    assert result['fixed']['meanArtworkDifference']>.5,'TV frames do not show sufficient actual artwork movement'
    assert result['fixed']['changedArtworkFraction']>.02,'Too little of the artwork visibly changes'
    assert result['fixed']['meanFrameDifference']<.01,'The frame moved or changed'
    assert result['fixed']['meanArtworkDifference']>3*result['old']['meanArtworkDifference'],'Motion did not materially improve'
    (ROOT/'.local/qa/motion-painted-results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
