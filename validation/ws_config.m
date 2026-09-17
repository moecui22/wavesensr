function c = ws_config()
% WS_CONFIG  The two settings every WaveSensr script needs. Edit here, nowhere else.
%
% c.url  where WaveSensr is running. 'http://localhost:8777' if MATLAB and the
%        boards are on the same machine; otherwise the Mac's address on the lab
%        network, e.g. 'http://192.168.1.42:8777'.
% c.dir  where the MATLAB logs go: a 'runs' folder beside these scripts, so the
%        package works from any folder on any machine without editing paths.

c.url = 'http://localhost:8777';
c.dir = fullfile(fileparts(mfilename('fullpath')), 'runs');
if ~exist(c.dir, 'dir'), mkdir(c.dir); end
end
