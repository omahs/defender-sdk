import { BaseApiClient } from '@openzeppelin/defender-sdk-base-client';
import { isArray } from 'lodash';
import { Interface } from 'ethers/lib/utils';
import { ExternalApiCreateProposalRequest as CreateProposalRequest, PartialContract } from '../models/proposal';
import { SimulationRequest as SimulationTransaction, SimulationResponse } from '../models/simulation';
import { ExternalApiProposalResponse as ProposalResponse, ProposalResponseWithUrl } from '../models/response';
import { getProposalUrl } from './utils';
import { Contract } from '../models/contract';

type CreateProposalParams = {
  proposal: CreateProposalRequest;
  simulate?: boolean;
  overrideSimulationOpts?: SimulationTransaction;
};

export class ProposalClient extends BaseApiClient {
  protected getPoolId(): string {
    return process.env.DEFENDER_POOL_ID || 'us-west-2_94f3puJWv';
  }

  protected getPoolClientId(): string {
    return process.env.DEFENDER_POOL_CLIENT_ID || '40e58hbc7pktmnp9i26hh5nsav';
  }

  protected getApiUrl(): string {
    return process.env.DEFENDER_API_URL || 'https://defender-api.openzeppelin.com/v2/';
  }

  public async addContract(contract: Contract): Promise<Contract> {
    return this.apiCall(async (api) => {
      return (await api.put('/contracts', contract)) as Contract;
    });
  }

  public async deleteContract(id: string): Promise<string> {
    return this.apiCall(async (api) => {
      return (await api.delete(`/contracts/${id}`)) as string;
    });
  }

  public async listContracts(): Promise<Omit<Contract, 'abi'>[]> {
    return this.apiCall(async (api) => {
      return (await api.get('/contracts')) as Omit<Contract, 'abi'>[];
    });
  }

  // added separate from CreateProposalRequest type as the `simulate` boolean is contained within defender-sdk
  public async create({
    proposal,
    simulate,
    overrideSimulationOpts,
  }: CreateProposalParams): Promise<ProposalResponseWithUrl> {
    return this.apiCall(async (api) => {
      let simulation: SimulationResponse | undefined = undefined;
      let simulationData = '0x';
      const isBatchProposal = (contract: PartialContract | PartialContract[]): contract is PartialContract[] =>
        isArray(contract);

      // handle simulation checks before creating proposal
      if (simulate) {
        // we do not support simulating batch proposals from the client.
        if (isBatchProposal(proposal.contract)) {
          throw new Error(
            'Simulating a batch proposal is currently not supported from the API. Use the Defender UI to manually trigger a simulation.',
          );
        }
        const overrideData = overrideSimulationOpts?.transactionData.data;
        simulationData = overrideData ?? '0x';
        // only check if we haven't overridden the simulation data property
        if (!overrideData) {
          // Check if ABI is provided so we can encode the function
          if (!proposal.contract.abi) {
            // no ABI found, request user to pass in `data` in overrideSimulationOpts
            throw new Error(
              'Simulation requested without providing ABI. Please provide the contract ABI or use the `overrideSimulationOpts` to provide the data property directly.',
            );
          }
          const contractInterface = new Interface(proposal.contract.abi);

          // this is defensive and should never happen since createProposal schema validation will fail without this property defined.
          if (!proposal.functionInterface) {
            // no function selected, request user to pass in `data` in overrideSimulationOpts
            throw new Error(
              'Simulation requested without providing function interface. Please provide the function interface or use the `overrideSimulationOpts` to provide the data property directly.',
            );
          }
          simulationData = contractInterface.encodeFunctionData(
            proposal.functionInterface.name!,
            proposal.functionInputs,
          );
        }
      }

      // create proposal
      const response = (await api.post('/proposals', proposal)) as ProposalResponse;

      // create simulation
      if (simulate && !isBatchProposal(proposal.contract)) {
        try {
          simulation = await this.simulate(response.proposalId, {
            contractId: response.contractId,
            transaction: {
              transactionData: {
                from: proposal.via,
                to: proposal.contract.address,
                data: simulationData,
                value: proposal.metadata?.sendValue ?? '0',
                ...overrideSimulationOpts?.transactionData,
              },
              blockNumber: overrideSimulationOpts?.blockNumber,
            },
          });
        } catch (e) {
          // simply log so we don't block createProposal response
          console.warn('Simulation Failed:', e);
        }
      }
      return { ...response, url: getProposalUrl(response), simulation };
    });
  }

  public async list(params: { includeArchived?: boolean } = {}): Promise<ProposalResponseWithUrl[]> {
    return this.apiCall(async (api) => {
      const response = (await api.get('/proposals', { params })) as ProposalResponse[];
      return response.map((proposal) => ({ ...proposal, url: getProposalUrl(proposal) }));
    });
  }

  public async get(id: string): Promise<ProposalResponseWithUrl> {
    return this.apiCall(async (api) => {
      const response = (await api.get(`/proposals/details/${id}`)) as ProposalResponse;
      return { ...response, url: getProposalUrl(response) };
    });
  }

  public async archive(id: string): Promise<ProposalResponseWithUrl> {
    return this.apiCall(async (api) => {
      const response = (await api.put(`proposals/archive/${id}`)) as ProposalResponse;
      return { ...response, url: getProposalUrl(response) };
    });
  }

  public async unarchive(id: string): Promise<ProposalResponseWithUrl> {
    return this.apiCall(async (api) => {
      const response = (await api.put(`/proposals/unarchive/${id}`)) as ProposalResponse;
      return { ...response, url: getProposalUrl(response) };
    });
  }

  public async getSimulation(proposalId: string, params: { contractId: string }): Promise<SimulationResponse> {
    return this.apiCall(async (api) => {
      const response = (await api.get(
        `/contracts/${params.contractId}/proposals/${proposalId}/simulation`,
      )) as SimulationResponse;
      return response;
    });
  }

  public async simulate(
    proposalId: string,
    params: { contractId: string; transaction: SimulationTransaction },
  ): Promise<SimulationResponse> {
    return this.apiCall(async (api) => {
      const response = (await api.post(
        `/contracts/${params.contractId}/proposals/${proposalId}/simulate`,
        params.transaction,
      )) as SimulationResponse;
      return response;
    });
  }
}
