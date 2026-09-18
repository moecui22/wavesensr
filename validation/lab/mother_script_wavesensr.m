clear all; clc
format compact

% C:\Data\ecui\WaveSensrTest\
cd(fileparts(mfilename('fullpath')))
addpath(genpath('matlab'))
subjID  = 'ws01a1'; 

%% experiment
run_experiment_wavesensr(subjID)
