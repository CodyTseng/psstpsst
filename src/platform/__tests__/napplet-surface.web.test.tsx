import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { NappletSurface } from '../napplet-surface.web';
import { platform } from '@/platform';
import { overlayPresentation } from '@/services/presentation/overlays';
jest.mock('@/platform',()=>({platform:{napplet:{capture:jest.fn(()=>new Promise(()=>{})),setBounds:jest.fn(async()=>{})}}}));
jest.mock('react-native',()=>{
  const React=jest.requireActual('react');
  const mock=Object.create(jest.requireActual('react-native'));
  Object.defineProperties(mock,{
    View:{value:React.forwardRef(function MockView(props:any,ref:any){return React.createElement('view',{...props,ref});})},
    Image:{value:'image'},StyleSheet:{value:{absoluteFill:{}}},
  });
  return mock;
});
let renderer:ReactTestRenderer;
beforeEach(()=>{
  jest.clearAllMocks();
  window.addEventListener=jest.fn();window.removeEventListener=jest.fn();
});
afterEach(()=>act(()=>renderer?.unmount()));
it('hides the native container immediately for any sheet, even before capture completes',async()=>{
  await act(async()=>{renderer=create(<NappletSurface id="app" visible/>,{createNodeMock:()=>({measureInWindow:(callback:Function)=>callback(0,0,300,600)})});});
  expect(platform.napplet.setBounds).toHaveBeenLastCalledWith('app',{x:0,y:0,width:300,height:600},true,true);
  let closeAccountSheet!:()=>void,closeNestedDialog!:()=>void;
  await act(async()=>{closeAccountSheet=overlayPresentation.register();});
  expect(platform.napplet.capture).toHaveBeenCalledWith('app');
  expect(platform.napplet.setBounds).toHaveBeenLastCalledWith('app',expect.anything(),false,false);
  await act(async()=>{closeNestedDialog=overlayPresentation.register();closeAccountSheet();});
  expect(overlayPresentation.getSnapshot()).toBe(true);
  expect(platform.napplet.setBounds).toHaveBeenLastCalledWith('app',expect.anything(),false,false);
  await act(async()=>{closeNestedDialog();});
  expect(platform.napplet.setBounds).toHaveBeenLastCalledWith('app',expect.anything(),true,true);
  expect(overlayPresentation.getSnapshot()).toBe(false);
});
