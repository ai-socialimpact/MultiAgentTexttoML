import React, { useState, useRef } from 'react';
import { Upload, FileText, Database as DatabaseIcon, Loader2 } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { localDb } from '../lib/localDb';

export const Files: React.FC = () => {
  const { currentProject, updateProject } = useProject();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !currentProject) return;

    setIsUploading(true);
    try {
      const updates: any = {};
      const newDataFiles: { name: string, url: string }[] = [...(currentProject.dataFiles || [])];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (file.name === 'schemadescription.txt') {
          updates.schemaDescription = await file.text();
        } else if (file.name === 'few_shot_description.txt') {
          updates.fewShotDescription = await file.text();
        } else if (file.name === 'classifer_guidelines.txt') {
          updates.classifierGuidelines = await file.text();
        } else if (file.name === 'Few_shot_examples.json') {
          updates.fewShotExamples = await file.text();
        } else if (file.name.endsWith('.csv')) {
          // Store file in localDb
          await localDb.files.put({
            projectId: currentProject.projectId,
            name: file.name,
            content: file, // Store as Blob
            type: file.type,
            uploadedAt: new Date().toISOString()
          });
          
          // Use a special prefix for local files so we know where to fetch them from
          const localUrl = `local://${file.name}`;
          
          if (!newDataFiles.find(f => f.name === file.name)) {
            newDataFiles.push({
              name: file.name,
              url: localUrl
            });
          }
        }
      }

      if (Object.keys(updates).length > 0 || newDataFiles.length > (currentProject.dataFiles?.length || 0)) {
        await updateProject(currentProject.projectId, {
          ...updates,
          dataFiles: newDataFiles
        });
      }
      
      alert('Files saved to browser storage successfully!');
    } catch (error) {
      console.error("Error saving files locally:", error);
      alert('Failed to save files locally.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Project Files</h2>
        <div>
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".txt,.csv,.json"
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isUploading ? 'Uploading...' : 'Upload Files'}
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 bg-gray-50 rounded-md text-gray-500">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">schemadescription.txt</h3>
            <p className="text-sm text-gray-500">
              {currentProject?.schemaDescription ? 'Uploaded' : 'Upload to define schema'}
            </p>
          </div>
        </div>
        
        <div className="border border-gray-200 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 bg-gray-50 rounded-md text-gray-500">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">few_shot_description.txt</h3>
            <p className="text-sm text-gray-500">
              {currentProject?.fewShotDescription ? 'Uploaded' : 'Upload for examples'}
            </p>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 bg-gray-50 rounded-md text-gray-500">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">classifer_guidelines.txt</h3>
            <p className="text-sm text-gray-500">
              {currentProject?.classifierGuidelines ? 'Uploaded' : 'Upload for classifier'}
            </p>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 bg-gray-50 rounded-md text-gray-500">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">Few_shot_examples.json</h3>
            <p className="text-sm text-gray-500">
              {currentProject?.fewShotExamples ? 'Uploaded' : 'Upload JSON examples'}
            </p>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 bg-gray-50 rounded-md text-gray-500">
            <DatabaseIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">Data Files (*.csv)</h3>
            <p className="text-sm text-gray-500">
              {currentProject?.dataFiles?.length || 0} file(s) uploaded
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
